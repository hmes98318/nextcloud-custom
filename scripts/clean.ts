#!/usr/bin/env node
/**
 * Removes what the test flow and the development stack leave behind in
 * Docker: test environments that an interrupted run or `npm test -- --keep`
 * did not remove, and the images that `npm run build` and `npm test` built.
 *
 * Usage:
 *   npm run clean -- [options]
 *
 * Options:
 *   --dev                Also remove the development stack with its data
 *   --image <tag>        Remove this image as well, such as an older tag that
 *                        the scripts did not build; repeatable
 *   --dry-run            List what would be removed and remove nothing
 *   -h, --help           Show this help
 *
 * It removes:
 *   - the containers, networks, and volumes of every test environment
 *     (Compose project nextcloud-custom-test-*)
 *   - the image nextcloud-custom:dev and every image that the build script
 *     labeled, which includes the builds that a rebuild left without a tag
 *
 * It leaves images of other projects, such as MariaDB and Redis, and the
 * Docker build cache alone, because other builds use them. Do not run it
 * while `npm test` is running, because that removes the running environment.
 * The exit code is 1 when something could not be removed.
 */

import { parseCommandLine, runMain } from './lib/cli.ts';
import { assertDockerReady } from './lib/docker.ts';
import {
  DEFAULT_IMAGE,
  DEV_PROJECT_NAME,
  IMAGE_LABEL,
  TEST_PROJECT_PREFIX,
} from './lib/paths.ts';
import { run, runChecked } from './lib/process.ts';
import {
  createSteps,
  printDetail,
  printError,
  printInfo,
  printSuccess,
  printWarning,
} from './lib/terminal.ts';

const STEP_ENVIRONMENTS = 'Remove test environments';
const STEP_IMAGES = 'Remove images';

/** Compose puts this label on everything that it creates for a project. */
const PROJECT_LABEL = 'com.docker.compose.project';

/** A kind of Docker resource that a Compose project owns. */
interface ResourceKind {
  /** The singular name, for messages. */
  noun: string;
  /** The command that lists the resources, without its filter and format. */
  list: string[];
  /** The template field that identifies a resource. */
  idField: string;
  /** The command that removes resources, given their identifiers. */
  remove: string[];
}

/** In removal order: a network or volume cannot go while a container uses it. */
const RESOURCE_KINDS: ResourceKind[] = [
  {
    noun: 'container',
    list: ['ps', '--all'],
    idField: '.ID',
    remove: ['rm', '--force', '--volumes'],
  },
  {
    noun: 'network',
    list: ['network', 'ls'],
    idField: '.ID',
    remove: ['network', 'rm'],
  },
  {
    noun: 'volume',
    list: ['volume', 'ls'],
    idField: '.Name',
    remove: ['volume', 'rm'],
  },
];

/** The resources of one kind that belong to one project. */
interface ProjectResources {
  project: string;
  kind: ResourceKind;
  ids: string[];
}

/** An image that can be removed, and the name to remove it by. */
interface ImageEntry {
  /** The tag, or the ID for an image without a tag. */
  reference: string;
  size: string;
}

/** Returns the first line of an error message from Docker, without its prefix. */
function firstLine(text: string): string {
  return (text.trim().split('\n')[0] ?? '').replace(
    /^Error response from daemon: /,
    '',
  );
}

/** Returns `1 container` or `4 containers`. */
function count(amount: number, noun: string): string {
  return `${String(amount)} ${noun}${amount === 1 ? '' : 's'}`;
}

/** Tells whether a Compose project is one that this script may remove. */
function isRemovable(project: string, includeDev: boolean): boolean {
  if (project === DEV_PROJECT_NAME) {
    return includeDev;
  }

  return (
    project.startsWith(TEST_PROJECT_PREFIX) &&
    /^[0-9a-f]+$/.test(project.slice(TEST_PROJECT_PREFIX.length))
  );
}

/** Finds the resources of the projects that the script may remove. */
async function findResources(includeDev: boolean): Promise<ProjectResources[]> {
  const found: ProjectResources[] = [];

  for (const kind of RESOURCE_KINDS) {
    const result = await runChecked('docker', [
      ...kind.list,
      '--filter',
      `label=${PROJECT_LABEL}`,
      '--format',
      `{{.Label "${PROJECT_LABEL}"}}|{{${kind.idField}}}`,
    ]);
    const byProject = new Map<string, string[]>();

    for (const line of result.stdout.split('\n')) {
      const [project = '', id = ''] = line.trim().split('|');

      if (id !== '' && isRemovable(project, includeDev)) {
        byProject.set(project, [...(byProject.get(project) ?? []), id]);
      }
    }

    for (const [project, ids] of byProject) {
      found.push({ project, kind, ids });
    }
  }

  return found;
}

/** Finds the images to remove: the default tag, extra tags, and labeled builds. */
async function findImages(extraTags: string[]): Promise<ImageEntry[]> {
  const format = '{{.ID}}|{{.Repository}}:{{.Tag}}|{{.Size}}';
  const queries = [
    ['--filter', `label=${IMAGE_LABEL}`],
    ...[DEFAULT_IMAGE, ...extraTags].map(tag => [tag]),
  ];
  const images = new Map<string, ImageEntry>();

  for (const query of queries) {
    const result = await runChecked('docker', [
      'image',
      'ls',
      '--all',
      ...query,
      '--format',
      format,
    ]);

    for (const line of result.stdout.split('\n')) {
      const [id = '', name = '', size = ''] = line.trim().split('|');

      if (id !== '') {
        // An image without a tag has to be removed by its ID.
        const reference = name === '<none>:<none>' ? id : name;

        images.set(reference, { reference, size });
      }
    }
  }

  return [...images.values()];
}

/** Removes the test environments and returns what could not be removed. */
async function removeEnvironments(
  includeDev: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const found = await findResources(includeDev);
  const projects = [...new Set(found.map(item => item.project))].sort();
  const failures: string[] = [];

  if (projects.length === 0) {
    printDetail('No test environment is left.');
  }

  for (const project of projects) {
    const owned = found.filter(item => item.project === project);
    const summary = owned
      .map(item => count(item.ids.length, item.kind.noun))
      .join(', ');

    if (dryRun) {
      printInfo(`  would remove ${project}: ${summary}`);
      continue;
    }

    let removed = true;

    for (const item of owned) {
      const result = await run('docker', [...item.kind.remove, ...item.ids]);

      if (result.code !== 0) {
        removed = false;
        failures.push(`${project}: ${firstLine(result.stderr)}`);
      }
    }

    if (removed) {
      printSuccess(`${project}: removed ${summary}`);
    }
  }

  return failures;
}

/** Removes the images and returns what could not be removed. */
async function removeImages(
  extraTags: string[],
  dryRun: boolean,
): Promise<string[]> {
  const images = await findImages(extraTags);
  const failures: string[] = [];

  if (images.length === 0) {
    printDetail('No test image is left.');
  }

  for (const image of images) {
    if (dryRun) {
      printInfo(`  would remove ${image.reference} (${image.size})`);
      continue;
    }

    const result = await run('docker', ['image', 'rm', image.reference]);

    if (result.code === 0) {
      printSuccess(`${image.reference}: removed (${image.size})`);
    } else {
      failures.push(`${image.reference}: ${firstLine(result.stderr)}`);
    }
  }

  return failures;
}

async function main(): Promise<number> {
  const { values } = parseCommandLine(import.meta.filename, {
    options: {
      dev: { type: 'boolean' },
      image: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
    },
  });
  const includeDev = values.dev === true;
  const dryRun = values['dry-run'] === true;
  const steps = createSteps([STEP_ENVIRONMENTS, STEP_IMAGES]);

  await assertDockerReady();

  steps.begin(
    STEP_ENVIRONMENTS,
    includeDev ? '(and the development stack)' : undefined,
  );

  const failures = await removeEnvironments(includeDev, dryRun);

  steps.begin(STEP_IMAGES);
  failures.push(...(await removeImages(values.image ?? [], dryRun)));

  if (failures.length > 0) {
    for (const failure of failures) {
      printWarning(`Not removed: ${failure}`);
    }

    printError('Some resources are still there.');
    printDetail(
      'An image stays while a container uses it. If the container belongs to the development stack, run with --dev.',
    );

    return 1;
  }

  printSuccess(dryRun ? 'Dry run: nothing was removed' : 'Docker is clean');

  return 0;
}

await runMain(main);
