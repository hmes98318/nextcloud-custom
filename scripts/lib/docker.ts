// Docker image builds and Docker Compose projects.

import { IMAGE_LABEL, REPO_ROOT } from './paths.ts';
import { run, runChecked, runInteractive } from './process.ts';
import type { RunResult } from './process.ts';
import { printChildLine } from './terminal.ts';

/** The oldest Compose release that supports inline `configs` content. */
const MIN_COMPOSE_VERSION = '2.23.1';

/** Compares dotted version numbers; true when `version` >= `minimum`. */
function isVersionAtLeast(version: string, minimum: string): boolean {
  const actual = version.replace(/^v/, '').split('.').map(Number);
  const wanted = minimum.split('.').map(Number);

  for (let index = 0; index < wanted.length; index++) {
    const have = actual[index] ?? 0;
    const need = wanted[index] ?? 0;

    if (have !== need) {
      return have > need;
    }
  }

  return true;
}

/** Fails early with a clear message when Docker or Compose cannot be used. */
export async function assertDockerReady(): Promise<void> {
  const server = await run('docker', [
    'version',
    '--format',
    '{{.Server.Version}}',
  ]);

  if (server.code !== 0) {
    throw new Error(
      'Docker is not running or not reachable. Start Docker and try again.',
    );
  }

  const compose = await run('docker', ['compose', 'version', '--short']);
  const version = compose.stdout.trim();

  if (compose.code !== 0 || !isVersionAtLeast(version, MIN_COMPOSE_VERSION)) {
    throw new Error(
      `Docker Compose ${MIN_COMPOSE_VERSION} or later is required (found: ${version || 'none'}).`,
    );
  }
}

export interface BuildImageOptions {
  tag: string;
  /** Target platform, such as `linux/amd64`. Defaults to the Docker host. */
  platform?: string;
  noCache?: boolean;
  /** Build arguments in `NAME=value` form. */
  buildArgs?: string[];
  /** Print the complete build log instead of only the build steps. */
  verbose?: boolean;
}

/** Matches the lines that start a build step in BuildKit's plain output. */
const BUILD_STEP_LINE = /^#\d+ (\[|ERROR|naming)/;

/** The longest step description that is printed; commands can be very long. */
const MAX_STEP_WIDTH = 110;

/** Shortens a long line with an ellipsis. */
function truncate(line: string): string {
  return line.length > MAX_STEP_WIDTH
    ? `${line.slice(0, MAX_STEP_WIDTH - 1)}…`
    : line;
}

/** Builds the image from the repository root. */
export async function buildImage(options: BuildImageOptions): Promise<void> {
  const args = [
    'build',
    '--progress',
    'plain',
    '--tag',
    options.tag,
    '--label',
    IMAGE_LABEL,
  ];

  if (options.platform !== undefined) {
    args.push('--platform', options.platform);
  }

  if (options.noCache === true) {
    args.push('--no-cache');
  }

  for (const buildArg of options.buildArgs ?? []) {
    args.push('--build-arg', buildArg);
  }

  args.push(REPO_ROOT);

  const tail: string[] = [];

  const env: Record<string, string> = {};

  env.DOCKER_BUILDKIT = '1';

  await runChecked('docker', args, {
    env,
    onLine: line => {
      tail.push(line);

      if (options.verbose === true) {
        printChildLine(line);
      } else if (BUILD_STEP_LINE.test(line)) {
        printChildLine(truncate(line));
      }
    },
  }).catch((error: unknown) => {
    // A failed build prints the end of the log, which holds the cause.
    if (options.verbose !== true) {
      tail.slice(-40).forEach(printChildLine);
    }

    throw error;
  });
}

export interface ExecOptions {
  /** User inside the container, such as `www-data`. */
  user?: string;
  /** Text written to the standard input of the command. */
  input?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ComposeProject {
  readonly name: string;
  /** Starts services and waits until they are healthy. */
  up(services?: string[]): Promise<void>;
  /** Removes containers, networks, and volumes of the project. */
  down(): Promise<void>;
  /** Runs a command in a running container and returns its result. */
  exec(
    service: string,
    command: string[],
    options?: ExecOptions,
  ): Promise<RunResult>;
  /** Returns the host port published for a container port. */
  port(service: string, containerPort: number): Promise<number>;
  /** Returns the log text of a service. */
  logs(service: string): Promise<string>;
  restart(service: string): Promise<void>;
  /** Runs `docker compose` attached to the terminal. */
  interactive(args: string[]): Promise<number>;
}

/**
 * Creates a handle on a Compose project. `env` provides the variables that
 * the Compose file substitutes.
 */
export function createComposeProject(
  name: string,
  file: string,
  env: Record<string, string>,
): ComposeProject {
  // `COMPOSE_PROFILES=*` makes `down` remove services that only run on demand.
  const projectEnv: Record<string, string> = { ...env };

  projectEnv.COMPOSE_PROFILES = '*';
  const base = [
    'compose',
    '--ansi',
    'never',
    '--progress',
    'plain',
    '--project-name',
    name,
    '--file',
    file,
  ];

  return {
    name,

    async up(services: string[] = []): Promise<void> {
      await runChecked(
        'docker',
        [
          ...base,
          'up',
          '--detach',
          '--wait',
          '--wait-timeout',
          '600',
          ...services,
        ],
        { env: projectEnv, onLine: printChildLine },
      );
    },

    async down(): Promise<void> {
      await run(
        'docker',
        [...base, 'down', '--volumes', '--remove-orphans', '--timeout', '5'],
        { env: projectEnv },
      );
    },

    exec(
      service: string,
      command: string[],
      options: ExecOptions = {},
    ): Promise<RunResult> {
      const args = [...base, 'exec', '--no-TTY'];

      if (options.user !== undefined) {
        args.push('--user', options.user);
      }

      for (const [key, value] of Object.entries(options.env ?? {})) {
        args.push('--env', `${key}=${value}`);
      }

      return run('docker', [...args, service, ...command], {
        env: projectEnv,
        input: options.input,
        timeoutMs: options.timeoutMs,
      });
    },

    async port(service: string, containerPort: number): Promise<number> {
      const result = await runChecked(
        'docker',
        [...base, 'port', service, String(containerPort)],
        { env: projectEnv },
      );
      const match = /:(\d+)\s*$/m.exec(result.stdout);

      if (match?.[1] === undefined) {
        throw new Error(
          `No published port for ${service}:${String(containerPort)}`,
        );
      }

      return Number(match[1]);
    },

    async logs(service: string): Promise<string> {
      const result = await runChecked(
        'docker',
        [...base, 'logs', '--no-color', '--no-log-prefix', service],
        { env: projectEnv },
      );

      return result.stdout + result.stderr;
    },

    async restart(service: string): Promise<void> {
      await runChecked(
        'docker',
        [...base, 'restart', '--timeout', '30', service],
        { env: projectEnv },
      );
    },

    interactive(args: string[]): Promise<number> {
      return runInteractive('docker', [...base, ...args], { env: projectEnv });
    },
  };
}
