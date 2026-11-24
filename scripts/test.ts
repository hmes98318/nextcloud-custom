#!/usr/bin/env node
/**
 * Runs the image test flow: builds the image, starts a throwaway test
 * environment, initializes Nextcloud, runs the suites, and removes the
 * environment, also when the flow fails or is interrupted. See docs/testing.md.
 *
 * Usage:
 *   npm test -- [options]
 *
 * Options:
 *   --skip-build         Test the existing image instead of building it
 *   --image <tag>        Image to build and test (default: nextcloud-custom:dev)
 *   --platform <name>    Target platform of the build, such as linux/amd64
 *   --no-cache           Rebuild every layer without the build cache
 *   --suite <name>       Run only this suite; repeatable. The install suite
 *                        always runs first.
 *   --list               List the suites and exit
 *   --keep               Leave the environment running after the flow, for
 *                        inspection
 *   --verbose            Print the complete build log, not only the steps
 *   -h, --help           Show this help
 *
 * The exit code is 0 when every case passes and 1 otherwise.
 */

import { randomBytes } from 'node:crypto';

import { parseCommandLine, runMain } from './lib/cli.ts';
import {
  assertDockerReady,
  buildImage,
  createComposeProject,
} from './lib/docker.ts';
import {
  DEFAULT_IMAGE,
  TEST_COMPOSE_FILE,
  TEST_PROJECT_PREFIX,
} from './lib/paths.ts';
import { run } from './lib/process.ts';
import {
  createSteps,
  printDetail,
  printInfo,
  printStep,
  printSummary,
  printWarning,
} from './lib/terminal.ts';
import { startTestEnvironment } from './lib/test-environment.ts';
import { runSuites } from './lib/test-runner.ts';
import type { FlowResult, Suite } from './lib/test-runner.ts';
import { SUITES } from './suites/index.ts';

/** The conventional exit code of a process that stopped on SIGINT. */
const INTERRUPTED_EXIT_CODE = 130;

const STEP_BUILD = 'Build image';
const STEP_START = 'Start test environment';
const STEP_RUN = 'Run the suites';
const STEP_REMOVE = 'Remove the test environment';

/** Returns the suites to run: the install suite, then the selected ones. */
function selectSuites(names: string[] | undefined): Suite[] {
  if (names === undefined || names.length === 0) {
    return SUITES;
  }

  const unknown = names.filter(name => !SUITES.some(s => s.name === name));

  if (unknown.length > 0) {
    const known = SUITES.map(suite => suite.name).join(', ');

    throw new Error(`Unknown suite: ${unknown.join(', ')} (known: ${known})`);
  }

  return SUITES.filter(
    (suite, index) => index === 0 || names.includes(suite.name),
  );
}

async function main(): Promise<number> {
  const { values } = parseCommandLine(import.meta.filename, {
    options: {
      'skip-build': { type: 'boolean' },
      image: { type: 'string' },
      platform: { type: 'string' },
      'no-cache': { type: 'boolean' },
      suite: { type: 'string', multiple: true },
      list: { type: 'boolean' },
      keep: { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  });

  if (values.list === true) {
    const width = Math.max(...SUITES.map(suite => suite.name.length));

    for (const suite of SUITES) {
      printInfo(`${suite.name.padEnd(width)}  ${suite.summary}`);
    }

    return 0;
  }

  const suites = selectSuites(values.suite);
  const image = values.image ?? DEFAULT_IMAGE;
  const projectName = `${TEST_PROJECT_PREFIX}${randomBytes(3).toString('hex')}`;

  await assertDockerReady();

  const skipBuild = values['skip-build'] === true;
  const keep = values.keep === true;

  // The list leaves out the steps that this run skips, so the numbers are
  // contiguous and the same whether the run passes, fails, or is interrupted.
  const steps = createSteps([
    ...(skipBuild ? [] : [STEP_BUILD]),
    STEP_START,
    STEP_RUN,
    ...(keep ? [] : [STEP_REMOVE]),
  ]);

  if (skipBuild) {
    const inspect = await run('docker', ['image', 'inspect', image]);

    if (inspect.code !== 0) {
      throw new Error(`Image ${image} does not exist. Run: npm run build`);
    }
  } else {
    steps.begin(STEP_BUILD, image);
    await buildImage({
      tag: image,
      platform: values.platform,
      noCache: values['no-cache'],
      verbose: values.verbose,
    });
  }

  // Removes the project even before the environment object exists, so an
  // interrupt during startup cleans up too.
  const project = createComposeProject(projectName, TEST_COMPOSE_FILE, {});
  let removal: Promise<void> | undefined;
  const remove = (): Promise<void> => (removal ??= project.down());

  const aborter = new AbortController();
  const interrupt = (signal: NodeJS.Signals): void => {
    aborter.abort();
    printWarning(`Received ${signal}, removing the test environment`);
    void remove().finally(() => process.exit(INTERRUPTED_EXIT_CODE));
  };

  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  const runFlow = async (): Promise<{ result: FlowResult; url: string }> => {
    steps.begin(STEP_START, projectName);

    const env = await startTestEnvironment({ image, projectName });

    printStep(`Nextcloud is served at ${env.httpsUrl}`);
    steps.begin(STEP_RUN);

    return {
      result: await runSuites(suites, env, aborter.signal),
      url: env.httpsUrl,
    };
  };

  const { result, url } = await runFlow().finally(async () => {
    if (!keep) {
      steps.begin(STEP_REMOVE);
      await remove();
    }
  });

  if (aborter.signal.aborted) {
    return INTERRUPTED_EXIT_CODE;
  }

  printSummary(result);

  if (keep) {
    printDetail(`Environment kept at ${url}`);
    printDetail('Remove it with: npm run clean');
  }

  return result.failed > 0 ? 1 : 0;
}

await runMain(main);
