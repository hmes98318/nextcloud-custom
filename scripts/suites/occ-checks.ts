// Nextcloud's own checks: the occ commands and the setup checks of the admin
// Overview, which Nextcloud maintains and extends with every release.

import assert from 'node:assert/strict';

import { readDockerfileArg } from '../lib/build-args.ts';
import { fetchUrl } from '../lib/http.ts';
import { expectRecord, expectString, getPath, parseJson } from '../lib/json.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';

/**
 * Warnings that every fresh instance shows and that the image does not cause:
 * mimetype migrations wait for `occ maintenance:repair --include-expensive`,
 * and two-factor authentication is an administrator's choice.
 */
const EXPECTED_WARNINGS = new Set([
  'MimeTypeMigrationAvailable',
  'TwoFactorConfiguration',
]);

/** Checks that depend on the web server, PHP, and database of the image. */
const MUST_SUCCEED = [
  'SecurityHeaders',
  'WellKnownUrls',
  'WebdavEndpoint',
  'DataDirectoryProtected',
  'HttpsUrlGeneration',
  'CodeIntegrity',
  'MemcacheConfigured',
  'FileLocking',
  'PhpOpcacheSetup',
  'PhpModules',
  'PhpMemoryLimit',
  'PhpOutputBuffering',
  'DebugMode',
  'DatabaseHasMissingColumns',
  'DatabaseHasMissingIndices',
  'DatabaseHasMissingPrimaryKeys',
  'MysqlUnicodeSupport',
  'TransactionIsolation',
  'AppDirsWithDifferentOwner',
  'RandomnessSecure',
];

/** Checks that need the address of a web client, which `occ` does not have. */
const WEB_REQUEST_ONLY = ['ForwardedForHeaders', 'BruteForceThrottler'];

const CRON_FILE = '/var/www/html/cron.php';

interface SetupFinding {
  /** The class name of the check without its namespace. */
  check: string;
  severity: string;
  description: string;
}

/** Flattens the report of the setup checks, which groups them by category. */
function readSetupChecks(report: unknown): SetupFinding[] {
  const findings: SetupFinding[] = [];

  for (const [category, checks] of Object.entries(
    expectRecord(report, 'the setup check report'),
  )) {
    for (const [name, check] of Object.entries(
      expectRecord(checks, `the ${category} checks`),
    )) {
      const description = getPath(check, 'description');

      findings.push({
        check: name.split('\\').pop() ?? name,
        severity: expectString(getPath(check, 'severity'), `${name} severity`),
        description: typeof description === 'string' ? description : '',
      });
    }
  }

  return findings;
}

/** Describes what a report shows that is wrong, or nothing when it is fine. */
function setupProblems(
  findings: SetupFinding[],
  mustSucceed: string[],
): string[] {
  const problems: string[] = [];
  const bySeverity = new Map(findings.map(item => [item.check, item]));

  for (const item of findings) {
    const expected =
      item.severity === 'success' ||
      item.severity === 'info' ||
      (item.severity === 'warning' && EXPECTED_WARNINGS.has(item.check));

    if (!expected) {
      problems.push(`${item.check} is ${item.severity}: ${item.description}`);
    }
  }

  for (const name of mustSucceed) {
    const item = bySeverity.get(name);

    if (item === undefined) {
      problems.push(`${name} did not run`);
    } else if (item.severity !== 'success') {
      problems.push(`${name} is ${item.severity}: ${item.description}`);
    }
  }

  return problems;
}

/** Runs an occ command as the web user and returns its output. */
async function occ(env: TestEnvironment, args: string[]): Promise<string> {
  const result = await env.occ(args);

  assert.equal(
    result.code,
    0,
    `occ ${args.join(' ')} exited with ${String(result.code)}: ${(result.stderr || result.stdout).slice(0, 1000)}`,
  );

  return result.stdout;
}

/**
 * Runs the Nextcloud background jobs once, as the cron job of the image does.
 * The "last cron run" check is an error until this has happened.
 */
async function runCron(env: TestEnvironment): Promise<void> {
  const result = await env.compose.exec(
    'cloud',
    ['php', '-d', 'apc.enable_cli=1', '-f', CRON_FILE],
    { user: 'www-data', timeoutMs: 120_000 },
  );

  assert.equal(result.code, 0, `cron.php failed: ${result.stderr}`);
}

export const occChecksSuite: Suite = {
  name: 'occ-checks',
  summary: 'run the checks and maintenance commands that Nextcloud provides',
  cases: [
    {
      name: 'occ status reports the installed version without a pending upgrade',
      async run(env) {
        const status = parseJson(await occ(env, ['status', '--output=json']));
        const version = readDockerfileArg('NEXTCLOUD_VERSION');

        assert.equal(getPath(status, 'installed'), true);
        assert.equal(getPath(status, 'versionstring'), version);
        assert.equal(getPath(status, 'needsDbUpgrade'), false);
        assert.equal(getPath(status, 'maintenance'), false);
      },
    },
    {
      name: 'the integrity check finds no altered, missing, or extra core file',
      async run(env) {
        const output = await occ(env, ['integrity:check-core']);

        assert.doesNotMatch(output, /INVALID_HASH|FILE_MISSING|EXTRA_FILE/);
      },
    },
    {
      name: 'occ setupchecks reports no error and only expected warnings',
      async run(env) {
        await runCron(env);

        const result = await env.occ(['setupchecks', '--output=json']);

        // occ exits with 1 when a check warns, so the report decides.
        assert.ok(
          result.code === 0 || result.code === 1,
          `occ setupchecks exited with ${String(result.code)}: ${result.stderr}`,
        );
        assert.deepEqual(
          setupProblems(
            readSetupChecks(parseJson(result.stdout)),
            MUST_SUCCEED,
          ),
          [],
        );
      },
    },
    {
      name: 'the setup checks of the admin Overview agree for a web request',
      async run(env) {
        const response = await env.admin.request(
          `${env.httpsUrl}/settings/setupcheck`,
          { headers: { accept: 'application/json' } },
        );

        assert.equal(response.status, 200);
        assert.deepEqual(
          setupProblems(readSetupChecks(response.json()), [
            ...MUST_SUCCEED,
            ...WEB_REQUEST_ONLY,
          ]),
          [],
        );
      },
    },
    {
      name: 'the nextcloud-upgrade script runs through as root',
      timeoutMs: 300_000,
      async run(env) {
        const result = await env.compose.exec('cloud', ['nextcloud-upgrade'], {
          timeoutMs: 280_000,
        });

        assert.equal(
          result.code,
          0,
          `nextcloud-upgrade failed:\n${result.stdout.slice(-2000)}${result.stderr}`,
        );
        assert.match(result.stdout, /Upgrade completed successfully/);
      },
    },
    {
      name: 'maintenance mode answers 503 and is switched off again',
      async run(env) {
        await occ(env, ['maintenance:mode', '--on']);

        try {
          const login = await fetchUrl(`${env.httpsUrl}/login`);
          const status = await fetchUrl(`${env.httpsUrl}/status.php`);

          assert.equal(login.status, 503);
          assert.equal(getPath(status.json(), 'maintenance'), true);
        } finally {
          await occ(env, ['maintenance:mode', '--off']);
        }

        const login = await fetchUrl(`${env.httpsUrl}/login`);

        assert.equal(login.status, 200);
      },
    },
  ],
};
