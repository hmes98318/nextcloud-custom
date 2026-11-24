#!/usr/bin/env node
/**
 * Builds the Nextcloud image for development and tests.
 *
 * Usage:
 *   npm run build -- [options]
 *
 * Options:
 *   --tag <name>         Image tag to build (default: nextcloud-custom:dev)
 *   --platform <name>    Target platform, such as linux/amd64 (default: the
 *                        platform of the Docker host)
 *   --build-arg <A=b>    Build argument of the Dockerfile, such as
 *                        NEXTCLOUD_VERSION=32.0.15; repeatable
 *   --no-cache           Rebuild every layer without the build cache
 *   --verbose            Print the complete build log, not only the steps
 *   -h, --help           Show this help
 */

import { parseCommandLine, runMain } from './lib/cli.ts';
import { assertDockerReady, buildImage } from './lib/docker.ts';
import { DEFAULT_IMAGE } from './lib/paths.ts';
import { formatDuration, printHeading, printSuccess } from './lib/terminal.ts';

async function main(): Promise<number> {
  const { values } = parseCommandLine(import.meta.filename, {
    options: {
      tag: { type: 'string' },
      platform: { type: 'string' },
      'build-arg': { type: 'string', multiple: true },
      'no-cache': { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  });
  const tag = values.tag ?? DEFAULT_IMAGE;

  await assertDockerReady();

  printHeading(`Build image ${tag}`);

  const started = Date.now();

  await buildImage({
    tag,
    platform: values.platform,
    noCache: values['no-cache'],
    buildArgs: values['build-arg'],
    verbose: values.verbose,
  });

  printSuccess(`Built ${tag} in ${formatDuration(Date.now() - started)}`);

  return 0;
}

await runMain(main);
