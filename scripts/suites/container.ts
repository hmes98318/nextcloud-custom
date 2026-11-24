// The container at runtime: versions, processes, permissions, certificates,
// cron, logs, and what survives a restart.

import assert from 'node:assert/strict';

import { readDockerfileArg } from '../lib/build-args.ts';
import { fetchUrl } from '../lib/http.ts';
import { getPath } from '../lib/json.ts';
import { DATA_DIRECTORY } from '../lib/nextcloud.ts';
import { runChecked } from '../lib/process.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';
import { probeTls } from '../lib/tls.ts';

const CONFIG_DIRECTORY = '/var/www/html/config';
const SESSION_DIRECTORY = '/var/www/nextcloud-sessions-tmp';
const SSL_DIRECTORY = '/etc/nginx/ssl';

/** The first line of every PEM encoded private key, and where keys could hide. */
const PRIVATE_KEY_MARKER = '-----BEGIN [A-Z ]*PRIVATE KEY-----';
const KEY_SEARCH_PATHS =
  '/etc /root /home /opt /srv /usr/local /var/www/html/config';

/** The extensions that Nextcloud requires and that the Dockerfile installs. */
const PHP_EXTENSIONS = [
  'apcu',
  'bcmath',
  'ctype',
  'curl',
  'dom',
  'exif',
  'fileinfo',
  'gd',
  'gmp',
  'iconv',
  'imagick',
  'intl',
  'ldap',
  'mbstring',
  'memcached',
  'openssl',
  'pcntl',
  'pdo_mysql',
  'posix',
  'redis',
  'session',
  'simplexml',
  'sodium',
  'xml',
  'xmlreader',
  'xmlwriter',
  'zend opcache',
  'zip',
  'zlib',
];

/** Runs a command in the cloud container and returns its output. */
async function inCloud(
  env: TestEnvironment,
  command: string[],
  user?: string,
): Promise<string> {
  const result = await env.compose.exec('cloud', command, { user });

  assert.equal(
    result.code,
    0,
    `${command.join(' ')} exited with ${String(result.code)}: ${result.stderr}`,
  );

  return result.stdout + result.stderr;
}

/** Returns the owner, group, and octal mode of a path in the cloud container. */
async function ownership(
  env: TestEnvironment,
  path: string,
): Promise<{ owner: string; mode: string }> {
  const output = await inCloud(env, ['stat', '--format', '%U:%G %a', path]);
  const [owner = '', mode = ''] = output.trim().split(' ');

  return { owner, mode };
}

/** Returns the users that run processes whose command line has the text. */
function usersOf(listing: string, commandText: string): Set<string> {
  const users = new Set<string>();

  for (const line of listing.split('\n')) {
    const [user = '', ...command] = line.trim().split(/\s+/);

    if (command.join(' ').includes(commandText)) {
      users.add(user);
    }
  }

  return users;
}

/** Reads the first value of a setting in the output of `php-fpm -i`. */
function phpSetting(info: string, name: string): string {
  const pattern = new RegExp(`^${name} => (\\S+)`, 'm');

  return pattern.exec(info)?.[1] ?? '(not listed)';
}

export const containerSuite: Suite = {
  name: 'container',
  summary: 'inspect the running container: processes, files, cron, and logs',
  cases: [
    {
      name: 'nginx and PHP are the versions that the Dockerfile pins',
      async run(env) {
        const nginx = readDockerfileArg('NGINX_VERSION');
        const phpImage = readDockerfileArg('PHP_IMAGE');
        const php = /^php:(\d+\.\d+\.\d+)-/.exec(phpImage)?.[1];

        assert.ok(php, `no PHP version in ${phpImage}`);
        assert.match(await inCloud(env, ['nginx', '-v']), new RegExp(nginx));
        assert.match(
          await inCloud(env, ['php-fpm', '-v']),
          new RegExp(`^PHP ${php} `),
        );
      },
    },
    {
      name: 'supervisor keeps nginx, PHP-FPM, cron, and fail2ban running',
      async run(env) {
        const status = await env.compose.exec('cloud', [
          'supervisorctl',
          'status',
        ]);

        for (const program of ['nginx', 'php-fpm', 'cron', 'fail2ban']) {
          assert.match(
            status.stdout,
            new RegExp(`^${program}\\s+RUNNING`, 'm'),
            `${program} is not running:\n${status.stdout}`,
          );
        }
      },
    },
    {
      name: 'the web server and PHP workers run without root privileges',
      async run(env) {
        const listing = await inCloud(env, ['ps', '-eo', 'user=,args=']);

        assert.deepEqual(
          [...usersOf(listing, 'nginx: worker process')],
          ['nginx'],
        );
        assert.deepEqual(
          [...usersOf(listing, 'php-fpm: pool www')],
          ['www-data'],
        );
      },
    },
    {
      name: 'the effective nginx configuration is valid and restrictive',
      async run(env) {
        const config = await inCloud(env, ['nginx', '-T']);

        assert.match(config, /^\s*server_tokens\s+off;/m);
        assert.match(config, /^\s*ssl_protocols\s+TLSv1\.2 TLSv1\.3;/m);
        assert.match(config, /^\s*ssl_session_tickets\s+off;/m);
        assert.doesNotMatch(config, /^\s*autoindex\s+on;/m);
        assert.doesNotMatch(
          config,
          /^\s*ssl_protocols[^;]*TLSv1(\.[01])?[ ;]/m,
        );
      },
    },
    {
      name: 'PHP shows no errors to visitors and does not announce itself',
      async run(env) {
        const info = await inCloud(env, ['php-fpm', '-i']);

        assert.equal(phpSetting(info, 'display_errors'), 'Off');
        assert.equal(phpSetting(info, 'expose_php'), 'Off');
        assert.equal(phpSetting(info, 'allow_url_include'), 'Off');
      },
    },
    {
      name: 'PHP has the extensions that Nextcloud and its apps use',
      async run(env) {
        const modules = (await inCloud(env, ['php', '-m']))
          .split('\n')
          .map(line => line.trim().toLowerCase());
        const missing = PHP_EXTENSIONS.filter(name => !modules.includes(name));

        assert.deepEqual(missing, []);
      },
    },
    {
      name: 'configuration, data, and sessions are private to the web user',
      async run(env) {
        const problems: string[] = [];

        for (const path of [
          CONFIG_DIRECTORY,
          DATA_DIRECTORY,
          SESSION_DIRECTORY,
          `${CONFIG_DIRECTORY}/config.php`,
        ]) {
          const { owner, mode } = await ownership(env, path);

          // The last digit of the mode is the permission of everyone else.
          if (owner !== 'www-data:www-data' || !mode.endsWith('0')) {
            problems.push(`${path} is ${owner} with mode ${mode}`);
          }
        }

        assert.deepEqual(problems, []);
      },
    },
    {
      name: 'the generated TLS key is readable by root only and fits its certificate',
      async run(env) {
        const key = await ownership(env, `${SSL_DIRECTORY}/nginx.key`);
        const fromCertificate = await inCloud(env, [
          'openssl',
          'x509',
          '-in',
          `${SSL_DIRECTORY}/nginx.crt`,
          '-noout',
          '-pubkey',
        ]);
        const fromKey = await inCloud(env, [
          'openssl',
          'pkey',
          '-in',
          `${SSL_DIRECTORY}/nginx.key`,
          '-pubout',
        ]);

        assert.deepEqual(key, { owner: 'root:root', mode: '600' });
        assert.equal(fromKey, fromCertificate);
      },
    },
    {
      name: 'the image itself carries no private key',
      async run(env) {
        // A container that only lists files: nothing starts, so nothing is
        // generated at runtime.
        const result = await runChecked('docker', [
          'run',
          '--rm',
          '--entrypoint',
          'sh',
          env.image,
          '-c',
          `ls ${SSL_DIRECTORY}; grep -rIl -e '${PRIVATE_KEY_MARKER}' ${KEY_SEARCH_PATHS} || true`,
        ]);

        assert.equal(result.stdout.trim(), '');
      },
    },
    {
      name: 'a certificate that the operator mounts is served and left unchanged',
      timeoutMs: 180_000,
      async run(env) {
        const subject = 'mounted.example.test';

        // The client container writes into the volume that the standalone
        // container mounts as its certificate directory.
        await env.compose.exec('client', [
          'openssl',
          'req',
          '-x509',
          '-nodes',
          '-newkey',
          'ec',
          '-pkeyopt',
          'ec_paramgen_curve:prime256v1',
          '-days',
          '2',
          '-keyout',
          '/mounted-ssl/nginx.key',
          '-out',
          '/mounted-ssl/nginx.crt',
          '-subj',
          `/CN=${subject}`,
        ]);

        const before = await env.compose.exec('client', [
          'sha256sum',
          '/mounted-ssl/nginx.crt',
        ]);

        await env.compose.up(['cloud-mounted']);

        const port = await env.compose.port('cloud-mounted', 443);
        const probe = await probeTls({ port });
        const after = await env.compose.exec('cloud-mounted', [
          'sha256sum',
          `${SSL_DIRECTORY}/nginx.crt`,
        ]);
        const logs = await env.compose.logs('cloud-mounted');

        assert.equal(probe.error, undefined);
        assert.equal(probe.certificate?.subject.CN, subject);
        assert.equal(
          after.stdout.split(' ')[0],
          before.stdout.split(' ')[0],
          'the certificate file was replaced',
        );
        assert.doesNotMatch(logs, /generating a self-signed/);
      },
    },
    {
      name: 'cron has the Nextcloud job and cron.php records its run',
      async run(env) {
        const crontab = await inCloud(env, ['crontab', '-l', '-u', 'www-data']);
        const started = Math.floor(Date.now() / 1000);

        await inCloud(
          env,
          ['php', '-d', 'apc.enable_cli=1', '-f', '/var/www/html/cron.php'],
          'www-data',
        );

        const last = await env.occ(['config:app:get', 'core', 'lastcron']);

        assert.match(
          crontab,
          /\*\/5 \* \* \* \* php .*\/var\/www\/html\/cron\.php/,
        );
        assert.ok(
          Number(last.stdout.trim()) >= started - 1,
          `lastcron is ${last.stdout.trim()}, before the run at ${String(started)}`,
        );
      },
    },
    {
      name: 'nginx writes its access log to the container output',
      async run(env) {
        await fetchUrl(`${env.httpsUrl}/status.php`, {
          headers: { 'user-agent': 'container-log-check' },
        });

        const logs = await env.compose.logs('cloud');

        assert.match(
          logs,
          /"GET \/status\.php HTTP\/[\d.]+" 200 .*container-log-check/,
        );
      },
    },
    {
      name: 'the TZ variable sets the time zone because tzdata is installed',
      async run(env) {
        const variables: Record<string, string> = {};

        variables.TZ = 'Asia/Tokyo';

        const result = await env.compose.exec('cloud', ['date', '+%z'], {
          env: variables,
        });

        assert.equal(result.stdout.trim(), '+0900');
      },
    },
    {
      name: 'data and settings survive a restart of the container',
      timeoutMs: 300_000,
      async run(env) {
        const admin = env.admin;
        const created = await admin.request(admin.fileUrl('restart.txt'), {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: 'still here',
        });

        assert.equal(created.status, 201);

        await env.restartCloud();

        const status = await fetchUrl(`${env.httpsUrl}/status.php`);
        const restarted = env.admin;
        const read = await restarted.request(restarted.fileUrl('restart.txt'));

        assert.equal(getPath(status.json(), 'maintenance'), false);
        assert.equal(read.status, 200);
        assert.equal(read.text(), 'still here');
      },
    },
  ],
};
