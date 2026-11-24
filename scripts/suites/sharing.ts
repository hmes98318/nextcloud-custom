// Sharing: public links with and without a password, and shares with users.

import assert from 'node:assert/strict';

import { fetchUrl } from '../lib/http.ts';
import { expectArray, expectString, getPath } from '../lib/json.ts';
import type { NextcloudClient } from '../lib/nextcloud.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';
import { propfind } from '../lib/webdav.ts';

const SHARES_API = '/apps/files_sharing/api/v1/shares';
const READ_ONLY = '1';
const LINK_SHARE = '3';
const USER_SHARE = '0';

/** Creates a file in the files of alice. */
async function createFile(
  alice: NextcloudClient,
  name: string,
  content: string,
): Promise<void> {
  const response = await alice.request(alice.fileUrl(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });

  assert.equal(response.status, 201, `create ${name}`);
}

/** Shares a file of alice and returns the data of the new share. */
async function createShare(
  env: TestEnvironment,
  form: Record<string, string>,
): Promise<unknown> {
  const result = await env
    .client(env.users.alice)
    .ocs('POST', SHARES_API, form);

  assert.equal(result.statusCode, 200, 'create share');

  return result.data;
}

export const sharingSuite: Suite = {
  name: 'sharing',
  summary: 'share files by public link and with other users',
  cases: [
    {
      name: 'an anonymous visitor downloads a file from a public link',
      async run(env) {
        const alice = env.client(env.users.alice);

        await createFile(alice, 'public.txt', 'shared by link');

        const share = await createShare(env, {
          path: '/public.txt',
          shareType: LINK_SHARE,
          permissions: READ_ONLY,
        });
        const token = expectString(getPath(share, 'token'), 'share token');
        const download = await fetchUrl(`${env.httpsUrl}/s/${token}/download`, {
          maxRedirects: 3,
        });

        assert.equal(download.status, 200);
        assert.equal(download.text(), 'shared by link');
      },
    },
    {
      name: 'a password protected link needs the right password',
      async run(env) {
        const alice = env.client(env.users.alice);

        await createFile(alice, 'secret.txt', 'behind a password');

        const share = await createShare(env, {
          path: '/secret.txt',
          shareType: LINK_SHARE,
          permissions: READ_ONLY,
          password: `Nc-${env.users.alice.password}`,
        });
        const token = expectString(getPath(share, 'token'), 'share token');
        const url = `${env.httpsUrl}/public.php/webdav/`;
        const wrong = await fetchUrl(url, {
          method: 'PROPFIND',
          headers: { depth: '0' },
          basicAuth: { user: token, password: 'wrong-password' },
        });
        const right = await fetchUrl(url, {
          method: 'GET',
          basicAuth: {
            user: token,
            password: `Nc-${env.users.alice.password}`,
          },
        });

        assert.equal(wrong.status, 401, 'wrong password');
        assert.equal(right.status, 200, 'right password');
        assert.equal(right.text(), 'behind a password');
      },
    },
    {
      name: 'a user share gives the other user access to the file',
      async run(env) {
        const alice = env.client(env.users.alice);
        const bob = env.client(env.users.bob);

        await createFile(alice, 'for-bob.txt', 'hello bob');
        await createShare(env, {
          path: '/for-bob.txt',
          shareType: USER_SHARE,
          shareWith: env.users.bob.user,
          permissions: READ_ONLY,
        });

        const read = await bob.request(bob.fileUrl('for-bob.txt'));
        const received = await bob.ocs(
          'GET',
          `${SHARES_API}?shared_with_me=true`,
        );
        const targets = expectArray(received.data, 'shares').map(share =>
          getPath(share, 'file_target'),
        );

        assert.equal(read.status, 200);
        assert.equal(read.text(), 'hello bob');
        assert.ok(
          targets.includes('/for-bob.txt'),
          'listed as shared with bob',
        );
      },
    },
    {
      name: 'a read-only share does not let the recipient change the file',
      async run(env) {
        const bob = env.client(env.users.bob);
        const write = await bob.request(bob.fileUrl('for-bob.txt'), {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: 'bob overwrites',
        });
        const read = await bob.request(bob.fileUrl('for-bob.txt'));

        assert.equal(write.status, 403);
        assert.equal(read.text(), 'hello bob');
      },
    },
    {
      name: 'deleting a share removes the access of the recipient',
      async run(env) {
        const alice = env.client(env.users.alice);
        const bob = env.client(env.users.bob);
        const shares = await alice.ocs('GET', SHARES_API);
        const share = expectArray(shares.data, 'shares').find(
          item => getPath(item, 'file_target') === '/for-bob.txt',
        );
        const id = expectString(getPath(share, 'id'), 'share id');
        const deleted = await alice.ocs('DELETE', `${SHARES_API}/${id}`);
        const read = await bob.request(bob.fileUrl('for-bob.txt'));
        const root = await propfind(bob, bob.fileUrl(''));

        assert.equal(deleted.statusCode, 200);
        assert.equal(read.status, 404);
        assert.ok(
          !root.text().includes('for-bob.txt'),
          'gone from the listing',
        );
      },
    },
  ],
};
