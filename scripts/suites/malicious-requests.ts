// How nginx answers requests that a browser never sends: path traversal, a
// data file addressed as a script, malformed or ambiguous HTTP, unusual
// methods, and line breaks in the request target.
//
// The suite tests the web server configuration of the image, not Nextcloud.
// Every case therefore requires that nginx itself refuses the request: the
// error page has to be one that nginx generates, so a refusal by PHP or by
// Nextcloud, which the request should never have reached, fails the case.

import assert from 'node:assert/strict';

import { fetchUrl, sendRaw } from '../lib/http.ts';
import type { HttpResponse, RawResponse } from '../lib/http.ts';
import { getPath } from '../lib/json.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';

/** Builds a request that closes the connection, so that the response ends. */
function request(line: string, headers: string[], body = ''): string {
  return `${line}\r\n${[...headers, 'Connection: close'].join('\r\n')}\r\n\r\n${body}`;
}

/** Builds a POST to the login page with the given framing headers and body. */
function post(framing: string[], body = '0\r\n\r\n'): string {
  return request('POST /login HTTP/1.1', ['Host: localhost', ...framing], body);
}

/** A data file in the web root that holds PHP code, to test PATH_INFO handling. */
const PROBE_FILE = '/var/www/html/index-probe.png';

/** The code of the probe file prints this only when PHP runs it. */
const EXECUTED_MARKER = 'PHP-EXECUTED';

/** The footer of the error pages that nginx generates itself. */
const NGINX_PAGE = '<hr><center>nginx</center>';

/** Text that only a leaked configuration file or system file contains. */
const LEAK_MARKERS = ['<?php', 'root:x:0:0', 'passwordsalt', 'dbpassword'];

/** Statuses with which nginx refuses a request target. */
const REFUSED_TARGET = [400, 403, 404];

/** Statuses with which nginx refuses a request that is not valid HTTP. */
const REFUSED_SYNTAX = [400, 413, 414, 431, 501, 505];

/** Ways to reach files outside the web root or hidden inside the installation. */
const TRAVERSAL_PATHS = [
  '/../../../../etc/passwd',
  '/%2e%2e/%2e%2e/etc/passwd',
  '/..%2f..%2f..%2fetc/passwd',
  '/.%2e/.%2e/etc/passwd',
  '/index.php/..%2f..%2fconfig/config.php',
  '/index.php/../lib/base.php',
  '/apps/../config/config.php',
  '/%63onfig/config.php',
  '/%63onfig/.htaccess',
  '/%6cib/composer/composer/installed.json',
  '/%33rdparty/icewind/streams/LICENSE.txt',
  '/apps/../lib/composer/composer/installed.json',
  '/%6eextclouddata/nextcloud.log',
  '//config//config.php',
  '/./config/./config.php',
  '/config/config.php/.',
  '/config/config.php%00.png',
  '/config/config.php;.png',
  '/%2ehtaccess',
  '/.HTACCESS',
];

/** Requests whose meaning differs between hops, as in request smuggling. */
const AMBIGUOUS_REQUESTS: Record<string, string> = {
  'Content-Length and Transfer-Encoding together': post([
    'Content-Length: 4',
    'Transfer-Encoding: chunked',
  ]),
  'two Content-Length headers that disagree': post([
    'Content-Length: 4',
    'Content-Length: 5',
  ]),
  'a Content-Length that is not a number': post(['Content-Length: abc']),
  'a negative Content-Length': post(['Content-Length: -1']),
  'an unknown Transfer-Encoding': post(['Transfer-Encoding: xchunked']),
  'a chunk size that is not hexadecimal': post(
    ['Transfer-Encoding: chunked'],
    'ZZ\r\nx\r\n0\r\n\r\n',
  ),
  'whitespace before the colon of a header': request('GET / HTTP/1.1', [
    'Host : localhost',
  ]),
  'a folded header line': request('GET / HTTP/1.1', [
    'Host: localhost',
    'X-Folded: a',
    ' continued',
  ]),
};

/** Requests that break the syntax of HTTP in the request line or the host. */
const INVALID_REQUESTS: Record<string, string> = {
  'a space in the request target': request('GET /a b HTTP/1.1', [
    'Host: localhost',
  ]),
  'a protocol version that does not exist': request('GET / HTTP/9.9', [
    'Host: localhost',
  ]),
  'a lowercase method': request('get / HTTP/1.1', ['Host: localhost']),
  'no Host header': request('GET / HTTP/1.1', []),
  'two Host headers': request('GET / HTTP/1.1', [
    'Host: localhost',
    'Host: evil.example.com',
  ]),
  'bytes that are not a request': 'x\u0000\u0001\u0002\r\n\r\n',
};

/** Methods that nginx does not serve on the root path. */
const UNUSUAL_METHODS = [
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'TRACE',
  'TRACK',
  'CONNECT',
  'FOO',
];

/** Sends a request with a target that must reach the server unchanged. */
function getRaw(env: TestEnvironment, rawPath: string): Promise<HttpResponse> {
  return fetchUrl(`${env.httpsUrl}/`, { rawPath });
}

/** Sends request bytes to the HTTPS port. */
function sendTo(env: TestEnvironment, payload: string): Promise<RawResponse> {
  return sendRaw(env.httpsUrl, payload);
}

/** Returns the markers of a leak that the text contains. */
function leaks(text: string): string[] {
  return LEAK_MARKERS.filter(marker => text.includes(marker));
}

/** Describes a status for a failure message. */
function describeStatus(status: number): string {
  return `HTTP ${String(status)}`;
}

/** Asserts that nginx answered with one of the statuses and an error page of its own. */
function assertNginxRefused(
  status: number,
  body: string,
  allowed: number[],
  label: string,
): void {
  assert.ok(
    allowed.includes(status),
    `${label}: answered ${describeStatus(status)}`,
  );
  assert.ok(
    body.includes(NGINX_PAGE),
    `${label}: ${describeStatus(status)} did not come from nginx`,
  );
  assert.deepEqual(leaks(body), [], label);
}

/**
 * Asserts that nginx refused a request that went over a socket: it sent an
 * error page of its own, or closed the connection without an answer. A
 * connection that stays open is a failure.
 */
function assertRawRefused(
  response: RawResponse,
  allowed: number[],
  label: string,
): void {
  assert.equal(response.ended, 'closed', `${label}: the connection hung`);

  if (response.status !== undefined) {
    assertNginxRefused(response.status, response.body, allowed, label);
  }
}

/** Asserts that the server still serves an ordinary request. */
async function assertStillServing(env: TestEnvironment): Promise<void> {
  const status = await fetchUrl(`${env.httpsUrl}/status.php`);

  assert.equal(status.status, 200, 'the server stopped serving');
  assert.equal(getPath(status.json(), 'installed'), true);
}

export const maliciousRequestsSuite: Suite = {
  name: 'malicious-requests',
  summary: 'send crafted paths and broken HTTP to nginx',
  cases: [
    {
      name: 'path traversal in any encoding is refused by nginx and reads nothing',
      async run(env) {
        for (const path of TRAVERSAL_PATHS) {
          const response = await getRaw(env, path);

          assertNginxRefused(
            response.status,
            response.text(),
            REFUSED_TARGET,
            path,
          );
        }
      },
    },
    {
      name: 'a path after an existing data file is refused before PHP and never run',
      async run(env) {
        // The file holds PHP code but is no script. Nginx must not hand it
        // to PHP when a path such as /file.png/x.php names it. The name
        // starts with "index" because the nginx configuration rewrites every
        // other .php path to index.php before it reaches the PHP location,
        // which would hide a missing check there.
        const write = await env.compose.exec('cloud', [
          'sh',
          '-c',
          `printf '%s' "<?php echo 'PHP-' . 'EXECUTED'; ?>" > ${PROBE_FILE}`,
        ]);

        assert.equal(write.code, 0, write.stderr);

        try {
          const control = await getRaw(env, '/index-probe.png');

          assert.equal(control.status, 200, 'the probe file is not served');
          assert.match(control.header('content-type') ?? '', /^image\/png/);
          assert.ok(!control.text().includes(EXECUTED_MARKER));

          for (const path of [
            '/index-probe.png/x.php',
            '/index-probe.png/.php',
            '/index-probe.png/index.php',
            '/index-probe.png%2fx.php',
            '/index-probe.png%00.php',
            '/index-probe.png/x.php/y',
          ]) {
            const response = await getRaw(env, path);

            assert.ok(
              !response.text().includes(EXECUTED_MARKER),
              `${path} ran the file`,
            );
            assertNginxRefused(
              response.status,
              response.text(),
              [400, 404],
              path,
            );
          }
        } finally {
          await env.compose.exec('cloud', ['rm', '-f', PROBE_FILE]);
        }
      },
    },
    {
      name: 'requests with ambiguous framing are refused',
      async run(env) {
        for (const [label, payload] of Object.entries(AMBIGUOUS_REQUESTS)) {
          assertRawRefused(await sendTo(env, payload), REFUSED_SYNTAX, label);
        }

        await assertStillServing(env);
      },
    },
    {
      name: 'requests that break HTTP syntax or name no valid host are refused',
      async run(env) {
        for (const [label, payload] of Object.entries(INVALID_REQUESTS)) {
          assertRawRefused(await sendTo(env, payload), REFUSED_SYNTAX, label);
        }

        await assertStillServing(env);
      },
    },
    {
      name: 'oversized headers and request targets are refused',
      async run(env) {
        const cases: Record<string, string> = {
          'a 70 KB header': request('GET / HTTP/1.1', [
            'Host: localhost',
            `X-Large: ${'a'.repeat(70_000)}`,
          ]),
          'a 20 KB request target': request(
            `GET /${'a'.repeat(20_000)} HTTP/1.1`,
            ['Host: localhost'],
          ),
        };

        for (const [label, payload] of Object.entries(cases)) {
          assertRawRefused(await sendTo(env, payload), REFUSED_SYNTAX, label);
        }

        await assertStillServing(env);
      },
    },
    {
      name: 'unusual HTTP methods on the root path are refused',
      async run(env) {
        for (const method of UNUSUAL_METHODS) {
          const response = await sendTo(
            env,
            request(`${method} / HTTP/1.1`, ['Host: localhost']),
          );

          assertRawRefused(response, [400, 405, 501], method);
        }

        await assertStillServing(env);
      },
    },
    {
      name: 'line breaks in the request target cannot inject headers into the HTTPS redirect',
      async run(env) {
        const response = await fetchUrl(`${env.httpUrl}/`, {
          rawPath: '/%0d%0aSet-Cookie:%20injected=1%0d%0aX-Injected:%201',
        });

        assert.equal(response.status, 301);
        assert.equal(response.header('x-injected'), undefined);
        assert.equal(response.headers['set-cookie'], undefined);
        // The redirect repeats the target, which has to stay encoded.
        assert.match(response.header('location') ?? '', /%0d%0aSet-Cookie/i);
      },
    },
  ],
};
