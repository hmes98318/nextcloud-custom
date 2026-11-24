// Everyday file operations over WebDAV: create, read, change, version, delete,
// restore from the trash, and previews.

import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';

import { expectString } from '../lib/json.ts';
import type { TestEnvironment } from '../lib/test-environment.ts';
import type { Suite } from '../lib/test-runner.ts';
import { listedNames, propfind, xmlValues } from '../lib/webdav.ts';

const TEXT_HEADERS = { 'Content-Type': 'text/plain' };

/** Builds one PNG chunk: length, type, data, and the CRC of type and data. */
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, checksum]);
}

/** Creates a valid single-color RGB PNG image. */
function createPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // color type: RGB

  // Each row starts with the filter type 0, followed by the pixels.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The file id of a resource, which the versions and preview APIs need. */
async function fileIdOf(env: TestEnvironment, path: string): Promise<string> {
  const alice = env.client(env.users.alice);
  const reply = await propfind(alice, alice.fileUrl(path), '0');
  const [fileId] = xmlValues(reply.text(), 'oc:fileid');

  return expectString(fileId, `file id of ${path}`);
}

export const filesSuite: Suite = {
  name: 'files',
  summary: 'create, read, change, version, delete, and restore files',
  cases: [
    {
      name: 'a folder and a text file are created and read back unchanged',
      async run(env) {
        const alice = env.client(env.users.alice);
        const folder = await alice.request(alice.fileUrl('docs'), {
          method: 'MKCOL',
        });
        const created = await alice.request(alice.fileUrl('docs/hello.txt'), {
          method: 'PUT',
          headers: TEXT_HEADERS,
          body: 'hello nextcloud',
        });
        const read = await alice.request(alice.fileUrl('docs/hello.txt'));

        assert.equal(folder.status, 201, 'MKCOL');
        assert.equal(created.status, 201, 'PUT');
        assert.equal(read.status, 200, 'GET');
        assert.equal(read.text(), 'hello nextcloud');
        assert.ok(read.header('etag'), 'the response has an ETag');
      },
    },
    {
      name: 'a file with spaces and Chinese characters keeps its name',
      async run(env) {
        const alice = env.client(env.users.alice);
        const name = '測試 檔案 (1).txt';
        const created = await alice.request(alice.fileUrl(`docs/${name}`), {
          method: 'PUT',
          headers: TEXT_HEADERS,
          body: '中文內容',
        });
        const listing = await propfind(alice, alice.fileUrl('docs'));
        const read = await alice.request(alice.fileUrl(`docs/${name}`));

        assert.equal(created.status, 201);
        assert.ok(listedNames(listing.text()).includes(name), 'listed by name');
        assert.equal(read.text(), '中文內容');
      },
    },
    {
      name: 'overwriting a file replaces the content and keeps the old version',
      async run(env) {
        const alice = env.client(env.users.alice);
        const url = alice.fileUrl('docs/versioned.txt');

        // Distinct modification times give the versions distinct names.
        const first = await alice.request(url, {
          method: 'PUT',
          headers: { ...TEXT_HEADERS, 'X-OC-Mtime': '1700000000' },
          body: 'version one',
        });
        const second = await alice.request(url, {
          method: 'PUT',
          headers: TEXT_HEADERS,
          body: 'version two',
        });
        const read = await alice.request(url);
        const fileId = await fileIdOf(env, 'docs/versioned.txt');
        const versions = await propfind(
          alice,
          `${alice.baseUrl}/remote.php/dav/versions/${env.users.alice.user}/versions/${fileId}`,
        );

        assert.equal(first.status, 201);
        assert.equal(second.status, 204);
        assert.equal(read.text(), 'version two');
        assert.equal(versions.status, 207);
        assert.ok(
          xmlValues(versions.text(), 'd:href').length >= 2,
          'the folder of versions lists the previous version',
        );
      },
    },
    {
      name: 'a file is moved and copied with the destination header',
      async run(env) {
        const alice = env.client(env.users.alice);
        const moved = await alice.request(alice.fileUrl('docs/hello.txt'), {
          method: 'MOVE',
          headers: { destination: alice.fileUrl('docs/renamed.txt') },
        });
        const copied = await alice.request(alice.fileUrl('docs/renamed.txt'), {
          method: 'COPY',
          headers: { destination: alice.fileUrl('docs/copy.txt') },
        });
        const old = await alice.request(alice.fileUrl('docs/hello.txt'));
        const renamed = await alice.request(alice.fileUrl('docs/renamed.txt'));
        const copy = await alice.request(alice.fileUrl('docs/copy.txt'));

        assert.equal(moved.status, 201, 'MOVE');
        assert.equal(copied.status, 201, 'COPY');
        assert.equal(old.status, 404);
        assert.equal(renamed.text(), 'hello nextcloud');
        assert.equal(copy.text(), 'hello nextcloud');
      },
    },
    {
      name: 'a deleted file lands in the trash and can be restored',
      async run(env) {
        const alice = env.client(env.users.alice);
        const trash = `${alice.baseUrl}/remote.php/dav/trashbin/${env.users.alice.user}/trash`;
        const deleted = await alice.request(alice.fileUrl('docs/copy.txt'), {
          method: 'DELETE',
        });
        const gone = await alice.request(alice.fileUrl('docs/copy.txt'));
        const listing = await propfind(alice, trash);
        const entry = listedNames(listing.text()).find(name =>
          name.startsWith('copy.txt.d'),
        );

        assert.equal(deleted.status, 204, 'DELETE');
        assert.equal(gone.status, 404);
        assert.ok(entry, 'the trash lists copy.txt');

        const restored = await alice.request(`${trash}/${entry}`, {
          method: 'MOVE',
          headers: {
            destination: `${alice.baseUrl}/remote.php/dav/trashbin/${env.users.alice.user}/restore/${entry}`,
          },
        });
        const back = await alice.request(alice.fileUrl('docs/copy.txt'));

        assert.equal(restored.status, 201, 'restore');
        assert.equal(back.text(), 'hello nextcloud');
      },
    },
    {
      name: 'a range request returns only the requested bytes',
      async run(env) {
        const alice = env.client(env.users.alice);
        const response = await alice.request(
          alice.fileUrl('docs/renamed.txt'),
          {
            headers: { range: 'bytes=0-4' },
          },
        );

        assert.equal(response.status, 206);
        assert.equal(response.text(), 'hello');
      },
    },
    {
      name: 'a PNG image gets a preview from the image libraries',
      async run(env) {
        const alice = env.client(env.users.alice);
        const upload = await alice.request(alice.fileUrl('docs/picture.png'), {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: createPng(256, 256),
        });
        const preview = await alice.request(
          '/core/preview.png?file=%2Fdocs%2Fpicture.png&x=64&y=64&a=true',
        );

        assert.equal(upload.status, 201);
        assert.equal(preview.status, 200);
        assert.match(preview.header('content-type') ?? '', /^image\//);
        assert.ok(preview.body.length > 50, 'the preview is not empty');
      },
    },
  ],
};
