#!/usr/bin/env node
/**
 * Runs a persistent development stack: the locally built image with MariaDB
 * and Redis, installed and reachable at fixed addresses. It uses the same
 * environment as the tests (tests/docker-compose.yml) under its own project.
 *
 * Usage:
 *   npm run dev -- <command> [options]
 *
 * Commands:
 *   up                  Start the stack, install Nextcloud if needed, and
 *                       print the address and the login
 *   down                Remove the stack and all its data
 *   logs [service]      Follow the logs of a service (default: cloud)
 *   shell [service]     Open a shell in a service (default: cloud)
 *   occ <arguments>     Run occ as www-data in the cloud container
 *
 * Options (for up):
 *   --build             Build the image first
 *   --image <tag>       Image to run (default: nextcloud-custom:dev)
 *   --http-port <n>     Host port for HTTP (default: 18080)
 *   --https-port <n>    Host port for HTTPS (default: 18443)
 *   -h, --help          Show this help
 *
 * The stack publishes on 127.0.0.1 only. The administrator is admin with the
 * password printed by `up`; the certificate is self-signed.
 */

import { parseCommandLine, runMain } from './lib/cli.ts';
import {
  assertDockerReady,
  buildImage,
  createComposeProject,
} from './lib/docker.ts';
import { fetchUrl } from './lib/http.ts';
import { getPath } from './lib/json.ts';
import { installNextcloud } from './lib/nextcloud.ts';
import {
  DEFAULT_IMAGE,
  DEV_PROJECT_NAME,
  TEST_COMPOSE_FILE,
} from './lib/paths.ts';
import { run } from './lib/process.ts';
import {
  createSteps,
  printDetail,
  printInfo,
  printStep,
  printSuccess,
} from './lib/terminal.ts';
import { startTestEnvironment } from './lib/test-environment.ts';

const STEP_BUILD = 'Build image';
const STEP_START = 'Start the development stack';
const STEP_INSTALL = 'Install Nextcloud';

/** Fixed credentials: the stack is local, and `up` can be run again. */
const ADMIN = { user: 'admin', password: 'Dev-Admin-Password-1' };
const SERVICE_PASSWORD = 'dev-service-password';

/** Starts the stack and installs Nextcloud when it is still empty. */
async function up(options: {
  build: boolean;
  image: string;
  httpPort: number;
  httpsPort: number;
}): Promise<void> {
  const steps = createSteps([
    ...(options.build ? [STEP_BUILD] : []),
    STEP_START,
    STEP_INSTALL,
  ]);

  if (options.build) {
    steps.begin(STEP_BUILD, options.image);
    await buildImage({ tag: options.image });
  } else if (
    (await run('docker', ['image', 'inspect', options.image])).code !== 0
  ) {
    throw new Error(
      `Image ${options.image} does not exist. Run: npm run build, or use --build`,
    );
  }

  steps.begin(STEP_START);

  const env = await startTestEnvironment({
    image: options.image,
    projectName: DEV_PROJECT_NAME,
    httpPort: options.httpPort,
    httpsPort: options.httpsPort,
    admin: ADMIN,
    servicePassword: SERVICE_PASSWORD,
  });

  steps.begin(STEP_INSTALL);

  const status = await fetchUrl(`${env.httpsUrl}/status.php`);

  if (getPath(status.json(), 'installed') === true) {
    printStep('Nextcloud is already installed');
  } else {
    await installNextcloud(env.httpsUrl, env.install);
  }

  printSuccess('The development stack is ready');
  printInfo(`  URL       ${env.httpsUrl}`);
  printInfo(`  Login     ${ADMIN.user} / ${ADMIN.password}`);
  printDetail('Stop and delete everything with: npm run dev -- down');
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const project = createComposeProject(DEV_PROJECT_NAME, TEST_COMPOSE_FILE, {});

  await assertDockerReady();

  // The arguments of occ are passed through untouched.
  if (command === 'occ') {
    return project.interactive([
      'exec',
      '--user',
      'www-data',
      'cloud',
      'php',
      '/var/www/html/occ',
      ...rest,
    ]);
  }

  const { values, positionals } = parseCommandLine(import.meta.filename, {
    options: {
      build: { type: 'boolean' },
      image: { type: 'string' },
      'http-port': { type: 'string' },
      'https-port': { type: 'string' },
    },
    allowPositionals: true,
  });
  const service = positionals[1] ?? 'cloud';

  switch (positionals[0] ?? '') {
    case 'up':
      await up({
        build: values.build === true,
        image: values.image ?? DEFAULT_IMAGE,
        httpPort: Number(values['http-port'] ?? 18_080),
        httpsPort: Number(values['https-port'] ?? 18_443),
      });

      return 0;

    case 'down':
      await project.down();
      printSuccess('The development stack is removed');

      return 0;

    case 'logs':
      return project.interactive([
        'logs',
        '--follow',
        '--tail',
        '100',
        service,
      ]);

    case 'shell':
      return project.interactive(['exec', service, 'bash']);

    default:
      throw new Error(
        `${positionals[0] === undefined ? 'Give a command' : `Unknown command '${positionals[0]}'`}: up, down, logs, shell, or occ. Run with --help for the usage.`,
      );
  }
}

await runMain(main);
