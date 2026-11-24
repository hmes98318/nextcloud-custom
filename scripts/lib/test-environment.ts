// The Docker Compose stack that the tests and the development commands use.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createComposeProject } from './docker.ts';
import type { ComposeProject } from './docker.ts';
import { fetchUrl } from './http.ts';
import type { BasicAuth } from './http.ts';
import { getPath } from './json.ts';
import { createClient, DATA_DIRECTORY } from './nextcloud.ts';
import type { InstallSettings, NextcloudClient } from './nextcloud.ts';
import { TEST_COMPOSE_FILE } from './paths.ts';
import type { RunResult } from './process.ts';

/** Where Nextcloud lives inside the cloud container. */
const OCC_PATH = '/var/www/html/occ';

export interface TestEnvironment {
  /** The image that the cloud container runs. */
  readonly image: string;
  readonly compose: ComposeProject;
  /** Base URL of the HTTP port on the host, without a trailing slash. */
  readonly httpUrl: string;
  /** Base URL of the HTTPS port on the host, without a trailing slash. */
  readonly httpsUrl: string;
  readonly install: InstallSettings;
  /** A client authenticated as the administrator. */
  readonly admin: NextcloudClient;
  /** Credentials of the regular users that the users suite creates. */
  readonly users: { readonly alice: BasicAuth; readonly bob: BasicAuth };
  /** Creates a client that authenticates as the given user. */
  client(auth: BasicAuth): NextcloudClient;
  /** Runs `occ` as the web server user inside the cloud container. */
  occ(args: string[]): Promise<RunResult>;
  /**
   * Restarts the cloud container and waits until Nextcloud answers again.
   * The container can come back on other host ports, so read `httpUrl` and
   * `httpsUrl` again afterwards.
   */
  restartCloud(): Promise<void>;
  /** Removes the environment completely. */
  destroy(): Promise<void>;
}

export interface StartOptions {
  image: string;
  /** Compose project name; it namespaces containers, networks, and volumes. */
  projectName: string;
  /** Fixed host ports. Free ports are chosen when they are left out. */
  httpPort?: number;
  httpsPort?: number;
  /** Fixed administrator credentials. Random ones are used when left out. */
  admin?: BasicAuth;
  /** Fixed service passwords. Random ones are used when left out. */
  servicePassword?: string;
}

const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 2000;

/** Waits until the installed Nextcloud reports its status over HTTPS. */
async function waitUntilInstalled(statusUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetchUrl(statusUrl);

      if (response.status === 200 && getPath(response.json(), 'installed')) {
        return;
      }
    } catch {
      // The container is still starting; try again.
    }

    await delay(READY_POLL_MS);
  }

  throw new Error(`Nextcloud did not answer at ${statusUrl} in time`);
}

/** Returns a random token that satisfies Nextcloud's password policy. */
function randomSecret(): string {
  return `Nc-${randomBytes(12).toString('hex')}`;
}

/**
 * Starts the stack and waits until every service is healthy. Nextcloud is
 * not installed yet: the first test does that through the web installer.
 */
export async function startTestEnvironment(
  options: StartOptions,
): Promise<TestEnvironment> {
  const dbPassword = options.servicePassword ?? randomSecret();
  const redisPassword = options.servicePassword ?? randomSecret();
  const admin = options.admin ?? { user: 'admin', password: randomSecret() };

  // An empty port variable makes Compose publish on a random free port.
  const variables: Record<string, string> = {};

  variables.TEST_IMAGE = options.image;
  variables.TEST_HTTP_PORT = String(options.httpPort ?? '');
  variables.TEST_HTTPS_PORT = String(options.httpsPort ?? '');
  variables.TEST_DB_PASSWORD = dbPassword;
  variables.TEST_REDIS_PASSWORD = redisPassword;

  const compose = createComposeProject(
    options.projectName,
    TEST_COMPOSE_FILE,
    variables,
  );

  try {
    // The standalone certificate container starts on demand only.
    await compose.up(['cloud', 'client']);
  } catch (error: unknown) {
    await compose.down();
    throw error;
  }

  let httpPort = await compose.port('cloud', 80);
  let httpsPort = await compose.port('cloud', 443);

  /** The published ports change when the container restarts. */
  const currentHttpsUrl = (): string =>
    `https://127.0.0.1:${String(httpsPort)}`;

  return {
    image: options.image,
    compose,
    get httpUrl(): string {
      return `http://127.0.0.1:${String(httpPort)}`;
    },
    get httpsUrl(): string {
      return currentHttpsUrl();
    },
    install: {
      admin,
      database: {
        user: 'nextcloud',
        password: dbPassword,
        name: 'nextcloud',
        host: 'db',
      },
      dataDirectory: DATA_DIRECTORY,
    },
    get admin(): NextcloudClient {
      return createClient(currentHttpsUrl(), admin);
    },
    users: {
      alice: { user: 'alice', password: randomSecret() },
      bob: { user: 'bob', password: randomSecret() },
    },
    client: (auth: BasicAuth): NextcloudClient =>
      createClient(currentHttpsUrl(), auth),
    occ(args: string[]): Promise<RunResult> {
      return compose.exec('cloud', ['php', OCC_PATH, ...args], {
        user: 'www-data',
      });
    },
    async restartCloud(): Promise<void> {
      await compose.restart('cloud');
      httpPort = await compose.port('cloud', 80);
      httpsPort = await compose.port('cloud', 443);
      await waitUntilInstalled(`${currentHttpsUrl()}/status.php`);
    },
    destroy(): Promise<void> {
      return compose.down();
    },
  };
}
