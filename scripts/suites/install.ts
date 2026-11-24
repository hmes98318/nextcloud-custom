// Initialization: the web installer, the first administrator, and login.

import assert from 'node:assert/strict';

import { readDockerfileArg } from '../lib/build-args.ts';
import { fetchUrl } from '../lib/http.ts';
import { getPath } from '../lib/json.ts';
import {
  DATA_DIRECTORY,
  installNextcloud,
  readInitialState,
} from '../lib/nextcloud.ts';
import type { Suite } from '../lib/test-runner.ts';

export const installSuite: Suite = {
  name: 'install',
  summary: 'initialize Nextcloud through the web installer',
  critical: true,
  cases: [
    {
      name: 'status.php reports that Nextcloud is not installed yet',
      async run(env) {
        const response = await fetchUrl(`${env.httpsUrl}/status.php`);

        assert.equal(response.status, 200);
        assert.equal(getPath(response.json(), 'installed'), false);
      },
    },
    {
      name: 'the installer page presets the data directory of this image',
      async run(env) {
        const response = await fetchUrl(`${env.httpsUrl}/index.php`);
        const state = readInitialState(response.text(), 'core-config');

        assert.equal(response.status, 200);
        assert.equal(getPath(state, 'directory'), DATA_DIRECTORY);
        assert.equal(getPath(state, 'hasAutoconfig'), true);
      },
    },
    {
      name: 'the installer finds no problem with the PHP setup or permissions',
      async run(env) {
        const response = await fetchUrl(`${env.httpsUrl}/index.php`);
        const state = readInitialState(response.text(), 'core-config');

        assert.deepEqual(getPath(state, 'errors'), []);
        assert.equal(getPath(state, 'htaccessWorking'), true);
      },
    },
    {
      name: 'the web installer creates the database and the administrator',
      timeoutMs: 600_000,
      async run(env) {
        const response = await installNextcloud(env.httpsUrl, env.install);

        assert.ok(
          response.status >= 200 && response.status < 400,
          `The installer answered HTTP ${String(response.status)}:\n${response.text().slice(0, 500)}`,
        );
      },
    },
    {
      name: 'status.php reports the installed version of the Dockerfile',
      async run(env) {
        const response = await fetchUrl(`${env.httpsUrl}/status.php`);
        const status = response.json();

        assert.equal(getPath(status, 'installed'), true);
        assert.equal(getPath(status, 'maintenance'), false);
        assert.equal(getPath(status, 'needsDbUpgrade'), false);
        assert.equal(
          getPath(status, 'versionstring'),
          readDockerfileArg('NEXTCLOUD_VERSION'),
        );
      },
    },
    {
      name: 'the administrator logs in with the installer password',
      async run(env) {
        const result = await env.admin.ocs('GET', '/cloud/user');

        assert.equal(result.http.status, 200);
        assert.equal(result.statusCode, 200);
        assert.equal(getPath(result.data, 'id'), env.install.admin.user);
        assert.equal(getPath(result.data, 'enabled'), true);
      },
    },
    {
      name: 'a wrong password is rejected with HTTP 401',
      async run(env) {
        const response = await fetchUrl(
          `${env.httpsUrl}/ocs/v2.php/cloud/user`,
          {
            headers: { 'OCS-APIRequest': 'true' },
            basicAuth: {
              user: env.install.admin.user,
              password: 'not-the-password',
            },
          },
        );

        assert.equal(response.status, 401);
      },
    },
  ],
};
