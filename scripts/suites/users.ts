// User and group provisioning, authentication, and app passwords (OCS API).

import assert from 'node:assert/strict';

import { readDockerfileArg } from '../lib/build-args.ts';
import { fetchUrl } from '../lib/http.ts';
import { expectArray, expectString, getPath } from '../lib/json.ts';
import type { Suite } from '../lib/test-runner.ts';

export const usersSuite: Suite = {
  name: 'users',
  summary: 'provision users and groups, log in, and use app passwords',
  cases: [
    {
      name: 'capabilities report the version that the Dockerfile installs',
      async run(env) {
        const result = await env.admin.ocs('GET', '/cloud/capabilities');

        assert.equal(result.http.status, 200);
        assert.equal(
          getPath(result.data, 'version', 'string'),
          readDockerfileArg('NEXTCLOUD_VERSION'),
        );
      },
    },
    {
      name: 'the administrator creates two users and a group',
      async run(env) {
        for (const auth of [env.users.alice, env.users.bob]) {
          const created = await env.admin.ocs('POST', '/cloud/users', {
            userid: auth.user,
            password: auth.password,
            displayName: `Test ${auth.user}`,
          });

          assert.equal(created.statusCode, 200, `create ${auth.user}`);
        }

        const group = await env.admin.ocs('POST', '/cloud/groups', {
          groupid: 'testers',
        });

        assert.equal(group.statusCode, 200, 'create group');

        const member = await env.admin.ocs(
          'POST',
          `/cloud/users/${env.users.alice.user}/groups`,
          { groupid: 'testers' },
        );

        assert.equal(member.statusCode, 200, 'add alice to the group');
      },
    },
    {
      name: 'a created user can be read back with display name and group',
      async run(env) {
        const result = await env.admin.ocs(
          'GET',
          `/cloud/users/${env.users.alice.user}`,
        );
        const groups = expectArray(getPath(result.data, 'groups'), 'groups');

        assert.equal(result.statusCode, 200);
        assert.equal(getPath(result.data, 'displayname'), 'Test alice');
        assert.equal(getPath(result.data, 'enabled'), true);
        assert.ok(groups.includes('testers'), 'alice is not in testers');
      },
    },
    {
      name: 'a regular user logs in with their own password',
      async run(env) {
        const result = await env
          .client(env.users.alice)
          .ocs('GET', '/cloud/user');

        assert.equal(result.http.status, 200);
        assert.equal(getPath(result.data, 'id'), env.users.alice.user);
      },
    },
    {
      name: 'a regular user cannot provision users',
      async run(env) {
        const result = await env
          .client(env.users.alice)
          .ocs('POST', '/cloud/users', {
            userid: 'mallory',
            password: env.users.alice.password,
          });

        assert.equal(result.http.status, 403);
      },
    },
    {
      name: 'a disabled user is locked out until the account is enabled again',
      async run(env) {
        const bob = env.client(env.users.bob);
        const path = `/cloud/users/${env.users.bob.user}`;

        assert.equal(
          (await env.admin.ocs('PUT', `${path}/disable`)).statusCode,
          200,
        );
        assert.notEqual((await bob.ocs('GET', '/cloud/user')).http.status, 200);

        assert.equal(
          (await env.admin.ocs('PUT', `${path}/enable`)).statusCode,
          200,
        );
        assert.equal((await bob.ocs('GET', '/cloud/user')).http.status, 200);
      },
    },
    {
      name: 'an app password works until it is revoked',
      async run(env) {
        const alice = env.client(env.users.alice);
        const created = await alice.ocs('GET', '/core/getapppassword');
        const token = expectString(
          getPath(created.data, 'apppassword'),
          'apppassword',
        );
        const withToken = env.client({
          user: env.users.alice.user,
          password: token,
        });

        assert.equal(
          (await withToken.ocs('GET', '/cloud/user')).http.status,
          200,
        );

        const revoked = await withToken.request(
          '/ocs/v2.php/core/apppassword',
          {
            method: 'DELETE',
          },
        );

        assert.equal(revoked.status, 200);
        assert.equal(
          (await withToken.ocs('GET', '/cloud/user')).http.status,
          401,
        );
      },
    },
    {
      name: 'a request without credentials is refused',
      async run(env) {
        const response = await fetchUrl(
          `${env.httpsUrl}/ocs/v2.php/cloud/user`,
          {
            headers: { 'OCS-APIRequest': 'true' },
          },
        );

        assert.equal(response.status, 401);
      },
    },
  ],
};
