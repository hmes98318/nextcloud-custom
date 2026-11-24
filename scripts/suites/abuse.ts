// Abuse: repeated failed logins from one address. These cases change the
// state of the container and restore it, so the suite runs last.

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { fetchUrl } from '../lib/http.ts';
import { getPath } from '../lib/json.ts';
import type { RunResult } from '../lib/process.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';

/** How the client container reaches nginx: by service name on the network. */
const CLOUD_URL = 'https://cloud';

const API_URL = `${CLOUD_URL}/ocs/v2.php/cloud/capabilities`;
const LOGIN_URL = `${CLOUD_URL}/login`;
const LOGIN_FORM = 'user=admin&password=wrong&requesttoken=none';
const WRONG_PASSWORD = 'wrong-password';

/** The jail bans after this many failures; see overlay/fail2ban/jail.d. */
const JAIL_MAX_RETRY = 30;
const JAIL = 'nextcloud';
const BAN_TIMEOUT_MS = 60_000;
const BAN_POLL_MS = 1000;
const BRUTEFORCE_SETTING = 'auth.bruteforce.protection.enabled';

/**
 * Runs curl in the client container, which has an address of its own. The
 * Host header names a trusted domain, because the service name is not one.
 * Every request opens a new connection: a connection that is already open
 * stays up when its address is banned and would hang until the timeout.
 */
function curlFromClient(
  env: TestEnvironment,
  args: string[],
): Promise<RunResult> {
  return env.compose.exec('client', [
    'curl',
    '--silent',
    '--insecure',
    '--connect-timeout',
    '3',
    '--max-time',
    '15',
    '--http1.1',
    '--header',
    'Connection: close',
    '--header',
    'Host: localhost',
    ...args,
  ]);
}

/** Returns the IPv4 address of the client container. */
async function clientAddress(env: TestEnvironment): Promise<string> {
  const result = await env.compose.exec('client', ['hostname', '-i']);
  const address = result.stdout.trim().split(/\s+/)[0];

  assert.ok(address, 'the client container has no address');

  return address;
}

/** Sends failed API logins in one curl run and returns the status codes. */
async function failedLogins(
  env: TestEnvironment,
  count: number,
): Promise<string[]> {
  const args = [
    '--header',
    'OCS-APIRequest: true',
    '--user',
    `admin:${WRONG_PASSWORD}`,
    '--write-out',
    '%{http_code}\\n',
  ];

  for (let sent = 0; sent < count; sent++) {
    args.push('--output', '/dev/null', API_URL);
  }

  const result = await curlFromClient(env, args);

  return result.stdout.trim().split('\n');
}

/** Returns the status code of a request from the client container. */
async function statusFromClient(env: TestEnvironment): Promise<string> {
  const result = await curlFromClient(env, [
    '--output',
    '/dev/null',
    '--write-out',
    '%{http_code}',
    `${CLOUD_URL}/status.php`,
  ]);

  return result.stdout.trim();
}

/** Returns what `occ security:bruteforce:attempts` reports for an address. */
async function bruteforceState(
  env: TestEnvironment,
  address: string,
): Promise<{ attempts: number; delayMs: number }> {
  const result = await env.occ(['security:bruteforce:attempts', address]);
  const attempts = /attempts: (\d+)/.exec(result.stdout)?.[1];
  const delayMs = /delay: (\d+)/.exec(result.stdout)?.[1];

  assert.ok(
    attempts !== undefined && delayMs !== undefined,
    `unexpected output: ${result.stdout}${result.stderr}`,
  );

  return { attempts: Number(attempts), delayMs: Number(delayMs) };
}

/** Returns the throttle header that a failed form login from the client gets. */
async function throttleFromClient(
  env: TestEnvironment,
): Promise<string | undefined> {
  const result = await curlFromClient(env, [
    '--dump-header',
    '-',
    '--output',
    '/dev/null',
    '--data',
    LOGIN_FORM,
    LOGIN_URL,
  ]);

  return /^x-nextcloud-bruteforce-throttled: (.+)$/im.exec(result.stdout)?.[1];
}

/** Reads the milliseconds from a throttle header such as `25000ms`. */
function delayOf(header: string | undefined): number {
  return Number.parseInt(header ?? '0', 10) || 0;
}

/** Returns the addresses that the fail2ban jail has banned. */
async function bannedAddresses(env: TestEnvironment): Promise<string[]> {
  const result = await env.compose.exec('cloud', [
    'fail2ban-client',
    'status',
    JAIL,
  ]);
  const list = /Banned IP list:\s*(.*)$/m.exec(result.stdout)?.[1] ?? '';

  return list.split(/\s+/).filter(item => item !== '');
}

/** Polls until the condition holds, or fails with the description. */
async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + BAN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await delay(BAN_POLL_MS);
  }

  assert.fail(`Timed out waiting until ${description}`);
}

export const abuseSuite: Suite = {
  name: 'abuse',
  summary: 'fail repeated logins from a second address and watch the defenses',
  cases: [
    {
      name: 'repeated failed logins throttle their address and no other',
      async run(env) {
        const address = await clientAddress(env);

        try {
          const codes = await failedLogins(env, 8);
          const state = await bruteforceState(env, address);
          const fromClient = await throttleFromClient(env);
          const fromHost = await fetchUrl(`${env.httpsUrl}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: LOGIN_FORM,
          });
          const admin = await env.admin.ocs('GET', '/cloud/capabilities');

          assert.deepEqual(new Set(codes), new Set(['401']));
          assert.ok(state.attempts >= 8, `${String(state.attempts)} attempts`);
          assert.ok(state.delayMs > 0, 'the address has no delay');

          // Earlier cases of the flow also failed a login or two from the
          // host address, so the host can carry a small delay of its own.
          const clientDelay = delayOf(fromClient);
          const hostDelay = delayOf(
            fromHost.header('x-nextcloud-bruteforce-throttled'),
          );

          assert.ok(
            clientDelay >= 3200,
            `the client delay is ${String(clientDelay)}`,
          );
          assert.ok(
            hostDelay < clientDelay,
            `the host delay ${String(hostDelay)} is not below the client delay`,
          );
          assert.equal(admin.statusCode, 200);
        } finally {
          await env.occ(['security:bruteforce:reset', address]);
        }

        assert.deepEqual(await bruteforceState(env, address), {
          attempts: 0,
          delayMs: 0,
        });
        assert.equal(await throttleFromClient(env), undefined);
      },
    },
    {
      name: 'the fail2ban filter matches failed logins and untrusted hosts in the log',
      async run(env) {
        await failedLogins(env, 2);
        await fetchUrl(`${env.httpsUrl}/login`, {
          headers: { host: 'untrusted.example.test' },
        });

        const log = '/var/www/html/nextclouddata/nextcloud.log';
        const expected = await env.compose.exec('cloud', [
          'grep',
          '--count',
          '--extended-regexp',
          'Login failed:|Trusted domain error',
          log,
        ]);
        const regex = await env.compose.exec('cloud', [
          'fail2ban-regex',
          log,
          JAIL,
        ]);
        const matched = /Failregex: (\d+) total/.exec(regex.stdout)?.[1];

        assert.ok(Number(expected.stdout) >= 3, 'the log has too few entries');
        assert.equal(Number(matched), Number(expected.stdout));
      },
    },
    {
      name: 'fail2ban cuts off an address after repeated failed logins and lets it back in',
      timeoutMs: 240_000,
      async run(env) {
        const address = await clientAddress(env);

        // Nextcloud's own throttle would slow the failures down, and the
        // ban depends on how fast they arrive.
        await env.occ([
          'config:system:set',
          BRUTEFORCE_SETTING,
          '--value=false',
          '--type=boolean',
        ]);

        try {
          assert.equal(await statusFromClient(env), '200', 'before the ban');

          await failedLogins(env, JAIL_MAX_RETRY + 5);
          await waitFor(`${address} is banned`, async () =>
            (await bannedAddresses(env)).includes(address),
          );

          const banned = await statusFromClient(env);
          const other = await fetchUrl(`${env.httpsUrl}/status.php`);

          assert.equal(banned, '000', 'the banned address still connects');
          assert.equal(getPath(other.json(), 'installed'), true);

          await env.compose.exec('cloud', [
            'fail2ban-client',
            'set',
            JAIL,
            'unbanip',
            address,
          ]);

          assert.equal(await statusFromClient(env), '200', 'after unbanning');
        } finally {
          await env.compose.exec('cloud', [
            'fail2ban-client',
            'set',
            JAIL,
            'unbanip',
            address,
          ]);
          await env.occ(['config:system:delete', BRUTEFORCE_SETTING]);
        }
      },
    },
  ],
};
