// Security of the web edge, seen from a client: redirects, TLS policy,
// response headers, blocked paths, and authentication.
//
// The checks follow the Nextcloud hardening guide
// (https://docs.nextcloud.com/server/stable/admin_manual/installation/harden_server.html)
// and the checks of the public Nextcloud Security Scan, which cannot reach a
// test stack on a developer machine.

import assert from 'node:assert/strict';

import { fetchUrl } from '../lib/http.ts';
import type { HttpResponse } from '../lib/http.ts';
import { getPath, parseJson } from '../lib/json.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';
import { probeTls } from '../lib/tls.ts';
import type { TlsProbeOptions } from '../lib/tls.ts';

/** The shortest HSTS lifetime that the hardening guide recommends (180 days). */
const MIN_HSTS_SECONDS = 15_552_000;

const NEXTCLOUD_LOG = '/var/www/html/nextclouddata/nextcloud.log';

/** Pages and error responses that must all carry the security headers. */
const HEADER_PATHS = [
  '/',
  '/login',
  '/status.php',
  '/does-not-exist',
  '/config/config.php',
  '/robots.txt',
];

/** Paths of the installation that must never be reachable over HTTP. */
const BLOCKED_PATHS = [
  '/config/config.php',
  '/config/',
  '/data/',
  '/nextclouddata/',
  '/nextclouddata/nextcloud.log',
  '/lib/base.php',
  '/lib/composer/composer/installed.json',
  '/3rdparty/icewind/streams/LICENSE.txt',
  '/config/.htaccess',
  '/config/CAN_INSTALL',
  '/3rdparty/autoload.php',
  '/build/',
  '/tests/',
  '/templates/',
  '/occ',
  '/console.php',
  '/.htaccess',
  '/.user.ini',
  '/.git/config',
  '/.env',
  '/db_structure.xml',
  '/composer.json',
  '/package.json',
  '/core/shipped.json',
  '/autotest.sh',
];

/**
 * Runs `openssl s_client` in the client container against the cloud
 * container. The container's OpenSSL still speaks the old protocols that
 * current Node.js refuses to offer, so it can prove that the server refuses
 * them. Returns the output and whether the handshake completed.
 */
async function openssl(
  env: TestEnvironment,
  options: string[],
): Promise<{ connected: boolean; output: string }> {
  const result = await env.compose.exec('client', [
    'openssl',
    's_client',
    '-connect',
    'cloud:443',
    '-servername',
    'localhost',
    ...options,
  ]);
  const output = result.stdout + result.stderr;

  return { connected: /Cipher is (?!\(NONE\))/.test(output), output };
}

/** Builds the options of a TLS probe for the HTTPS port of the environment. */
function tlsOptions(
  env: TestEnvironment,
  options: Omit<TlsProbeOptions, 'port'>,
): TlsProbeOptions {
  return { ...options, port: Number(new URL(env.httpsUrl).port) };
}

/** Sends a request to the HTTPS port. */
function get(
  env: TestEnvironment,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return fetchUrl(`${env.httpsUrl}${path}`, { headers });
}

/** The headers that nginx sets, each of which must appear once and as given. */
const EXPECTED_HEADERS: Record<string, string> = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'x-permitted-cross-domain-policies': 'none',
  'x-robots-tag': 'noindex, nofollow',
};

/**
 * Lists what is wrong with the security headers of a response. A header sent
 * twice, by nginx and by PHP, reaches the client as a comma-joined value, so
 * comparing the exact value finds duplicates as well as missing headers.
 */
function securityHeaderProblems(
  response: HttpResponse,
  where: string,
): string[] {
  const problems: string[] = [];
  const hsts = response.header('strict-transport-security') ?? '';
  const seconds = Number(/max-age=(\d+)/.exec(hsts)?.[1]);

  if (!(seconds >= MIN_HSTS_SECONDS) || !hsts.includes('includeSubDomains')) {
    problems.push(`${where}: strict-transport-security is "${hsts}"`);
  }

  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    const actual = response.header(name);

    if (actual !== expected) {
      problems.push(`${where}: ${name} is "${actual ?? 'missing'}"`);
    }
  }

  return problems;
}

export const edgeSecuritySuite: Suite = {
  name: 'edge-security',
  summary: 'check redirects, TLS, headers, blocked paths, and authentication',
  cases: [
    {
      name: 'HTTP requests are redirected to HTTPS and keep the path and query',
      async run(env) {
        const response = await fetchUrl(
          `${env.httpUrl}/login?redirect_url=%2Ffoo`,
        );

        assert.equal(response.status, 301);
        assert.match(
          response.header('location') ?? '',
          /^https:\/\/127\.0\.0\.1\/login\?redirect_url=%2Ffoo$/,
        );
        assert.equal(
          response.header('strict-transport-security'),
          undefined,
          'HSTS is only meaningful, and only sent, over HTTPS',
        );
      },
    },
    {
      name: 'the ACME challenge path is answered over HTTP instead of redirected',
      async run(env) {
        const response = await fetchUrl(
          `${env.httpUrl}/.well-known/acme-challenge/probe`,
        );

        assert.equal(response.status, 404);
      },
    },
    {
      name: 'HTTPS serves HTTP/2 over TLS 1.3 with a modern cipher',
      async run(env) {
        const probe = await probeTls(
          tlsOptions(env, { alpn: ['h2', 'http/1.1'] }),
        );

        assert.equal(probe.error, undefined);
        assert.equal(probe.protocol, 'TLSv1.3');
        assert.equal(probe.alpn, 'h2');
        assert.match(
          probe.cipher,
          /^TLS_(AES_(128|256)_GCM|CHACHA20_POLY1305)/,
        );
      },
    },
    {
      name: 'TLS 1.2 clients get an ECDHE AEAD cipher with forward secrecy',
      async run(env) {
        const probe = await probeTls(
          tlsOptions(env, { maxVersion: 'TLSv1.2' }),
        );

        assert.equal(probe.error, undefined);
        assert.equal(probe.protocol, 'TLSv1.2');
        assert.match(
          probe.cipher,
          /^ECDHE-(ECDSA|RSA)-(AES(128|256)-GCM-SHA(256|384)|CHACHA20-POLY1305)$/,
        );
      },
    },
    {
      name: 'TLS 1.1 and TLS 1.0 handshakes are refused',
      async run(env) {
        const control = await openssl(env, ['-tls1_2']);

        assert.ok(
          control.connected,
          `TLS 1.2 control failed:\n${control.output}`,
        );

        for (const flag of ['-tls1_1', '-tls1']) {
          const attempt = await openssl(env, [
            flag,
            '-cipher',
            'ALL:@SECLEVEL=0',
          ]);

          assert.ok(!attempt.connected, `${flag} was accepted`);
          assert.match(attempt.output, /alert protocol version/, flag);
        }
      },
    },
    {
      name: 'TLS 1.2 ciphers without forward secrecy or AEAD are refused',
      async run(env) {
        const control = await openssl(env, [
          '-tls1_2',
          '-cipher',
          'ECDHE-ECDSA-AES128-GCM-SHA256',
        ]);

        assert.ok(control.connected, `control failed:\n${control.output}`);

        for (const cipher of [
          'AES128-SHA',
          'AES256-SHA',
          'DES-CBC3-SHA',
          'ECDHE-ECDSA-AES128-SHA',
          'ECDHE-ECDSA-AES256-SHA384',
        ]) {
          const attempt = await openssl(env, [
            '-tls1_2',
            '-cipher',
            `${cipher}:@SECLEVEL=0`,
          ]);

          assert.ok(!attempt.connected, `${cipher} was accepted`);
        }
      },
    },
    {
      name: 'the certificate is a valid ECDSA certificate for localhost',
      async run(env) {
        const probe = await probeTls(tlsOptions(env, {}));
        const certificate = probe.certificate;

        assert.ok(certificate, 'the server presented no certificate');
        assert.equal(certificate.asn1Curve, 'prime256v1');
        assert.match(certificate.subjectaltname ?? '', /DNS:localhost/);

        const days =
          (Date.parse(certificate.valid_to) - Date.now()) / 86_400_000;

        assert.ok(
          days > 30,
          `the certificate expires in ${days.toFixed(0)} days`,
        );
      },
    },
    {
      name: 'every kind of response carries the security headers',
      async run(env) {
        const problems: string[] = [];

        for (const path of HEADER_PATHS) {
          problems.push(...securityHeaderProblems(await get(env, path), path));
        }

        assert.deepEqual(problems, []);
      },
    },
    {
      name: 'the login page sends a restrictive Content-Security-Policy',
      async run(env) {
        const response = await get(env, '/login');
        const policy = response.header('content-security-policy') ?? '';

        assert.match(policy, /default-src 'none'/);
        assert.match(policy, /frame-ancestors 'self'/);
      },
    },
    {
      name: 'responses do not disclose the nginx or PHP version',
      async run(env) {
        for (const path of ['/', '/login', '/does-not-exist', '/status.php']) {
          const response = await get(env, path);

          assert.equal(response.header('server'), 'nginx', path);
          assert.equal(response.header('x-powered-by'), undefined, path);
        }
      },
    },
    {
      name: 'session cookies are HttpOnly and Secure over HTTPS',
      async run(env) {
        const response = await get(env, '/login');
        const cookies = response.headers['set-cookie'] ?? [];

        assert.ok(cookies.length > 0, 'the login page sets no cookie');

        for (const cookie of cookies) {
          assert.match(cookie, /;\s*httponly/i, cookie);
          assert.match(cookie, /;\s*secure/i, cookie);
        }
      },
    },
    {
      name: 'internal paths and hidden files answer 404',
      async run(env) {
        for (const path of BLOCKED_PATHS) {
          const response = await get(env, path);

          assert.equal(response.status, 404, path);
          assert.ok(!response.text().includes('<?php'), `${path} leaks source`);
        }
      },
    },
    {
      name: 'PHP files outside the entry points are not executed or shown',
      async run(env) {
        for (const path of [
          '/apps/files/lib/App.php',
          '/apps/files/appinfo/routes.php',
          '/core/templates/layout.base.php',
        ]) {
          const response = await get(env, path);

          // Nextcloud answers a request that no route handles with a login
          // redirect, 401 or 404. What matters is the page is neither
          // served as content nor an error of the server.
          assert.ok(
            response.status >= 300 && response.status < 500,
            `${path} answered HTTP ${String(response.status)}`,
          );
          assert.ok(!response.text().includes('<?php'), `${path} leaks source`);
        }
      },
    },
    {
      name: 'an uploaded PHP file is stored as data and cannot be requested',
      async run(env) {
        const alice = env.client(env.users.alice);
        const marker = 'PHP-WAS-EXECUTED';
        const upload = await alice.request(alice.fileUrl('shell.php'), {
          method: 'PUT',
          body: `<?php echo "${marker}"; ?>`,
        });

        assert.equal(upload.status, 201);

        for (const path of [
          '/shell.php',
          `/nextclouddata/${env.users.alice.user}/files/shell.php`,
          `/data/${env.users.alice.user}/files/shell.php`,
        ]) {
          const response = await get(env, path);

          assert.equal(response.status, 404, path);
          assert.ok(!response.text().includes(marker), `${path} ran the file`);
        }
      },
    },
    {
      name: 'directories are never listed',
      async run(env) {
        for (const path of ['/apps/', '/core/', '/apps/files/', '/themes/']) {
          const response = await get(env, path);

          assert.ok(!/Index of/i.test(response.text()), `${path} lists files`);
        }
      },
    },
    {
      name: 'DAV, OCS, and the settings need authentication',
      async run(env) {
        const dav = await fetchUrl(`${env.httpsUrl}/remote.php/dav/`, {
          method: 'PROPFIND',
          headers: { depth: '0' },
        });
        const webdav = await get(env, '/remote.php/webdav/');
        const ocs = await get(env, '/ocs/v2.php/cloud/users', {
          'OCS-APIRequest': 'true',
        });
        const settings = await get(env, '/settings/users');

        assert.equal(dav.status, 401, 'DAV');
        assert.equal(webdav.status, 401, 'WebDAV');
        assert.equal(ocs.status, 401, 'OCS');
        assert.notEqual(settings.status, 200, 'settings');
        assert.ok(!settings.text().includes('alice'), 'settings leak users');
      },
    },
    {
      name: 'a request for an untrusted host name is rejected',
      async run(env) {
        const response = await get(env, '/', { host: 'evil.example.com' });

        assert.equal(response.status, 400);
      },
    },
    {
      name: 'the HTTP method TRACE is not accepted',
      async run(env) {
        const response = await fetchUrl(`${env.httpsUrl}/`, {
          method: 'TRACE',
        });

        assert.ok(
          response.status === 405 || response.status === 501,
          `TRACE answered HTTP ${String(response.status)}`,
        );
      },
    },
    {
      name: 'a forged X-Forwarded-For header from an untrusted client is ignored',
      async run(env) {
        const spoofedAddress = '203.0.113.50';

        // A failed login is logged with the address that Nextcloud sees.
        await fetchUrl(`${env.httpsUrl}/ocs/v2.php/cloud/user`, {
          headers: {
            'OCS-APIRequest': 'true',
            'X-Forwarded-For': spoofedAddress,
          },
          basicAuth: { user: 'forged-address-probe', password: 'wrong' },
        });

        const log = await env.compose.exec('cloud', ['cat', NEXTCLOUD_LOG]);
        const entry = log.stdout
          .split('\n')
          .find(line => line.includes('forged-address-probe'));

        assert.ok(entry, 'the failed login was not logged');

        const remoteAddress = getPath(parseJson(entry), 'remoteAddr');

        assert.equal(typeof remoteAddress, 'string');
        assert.notEqual(remoteAddress, spoofedAddress);
      },
    },
  ],
};
