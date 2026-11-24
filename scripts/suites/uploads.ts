// Large uploads: one request of 128 MiB and chunked assembly, compared by
// SHA-256, to prove that nginx and PHP-FPM accept and assemble big files.

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { fetchDigest } from '../lib/http.ts';
import type { Suite } from '../lib/test-runner.ts';

const MIB = 1024 * 1024;
const LARGE_FILE_SIZE = 128 * MIB;
const CHUNK_SIZE = 5 * MIB;

/** A pseudo-random file that can be streamed more than once. */
interface TestFile {
  bytes: number;
  sha256: string;
  blocks(): Generator<Buffer>;
  stream(): Readable;
}

/** Creates a file of the given size from one random block, repeated. */
function createTestFile(bytes: number): TestFile {
  const block = randomBytes(MIB);

  function* blocks(): Generator<Buffer> {
    for (let sent = 0; sent < bytes; sent += block.length) {
      yield block.subarray(0, Math.min(block.length, bytes - sent));
    }
  }

  const hash = createHash('sha256');

  for (const part of blocks()) {
    hash.update(part);
  }

  return {
    bytes,
    sha256: hash.digest('hex'),
    blocks,
    stream: () => Readable.from(blocks()),
  };
}

export const uploadsSuite: Suite = {
  name: 'uploads',
  summary: 'upload large files in one request and in chunks',
  cases: [
    {
      name: 'a 128 MiB file uploads in one request and downloads identical',
      timeoutMs: 600_000,
      async run(env) {
        const alice = env.client(env.users.alice);
        const file = createTestFile(LARGE_FILE_SIZE);
        const url = alice.fileUrl('large.bin');
        const upload = await alice.request(url, {
          method: 'PUT',
          headers: { 'Content-Length': String(file.bytes) },
          body: file.stream(),
          timeoutMs: 600_000,
        });
        const download = await fetchDigest(url, { basicAuth: alice.auth });

        assert.equal(upload.status, 201, 'PUT');
        assert.equal(download.status, 200, 'GET');
        assert.equal(download.bytes, file.bytes, 'size');
        assert.equal(download.sha256, file.sha256, 'checksum');
      },
    },
    {
      name: 'a file uploaded in chunks is assembled into one identical file',
      timeoutMs: 600_000,
      async run(env) {
        const alice = env.client(env.users.alice);
        const chunks = [
          createTestFile(CHUNK_SIZE),
          createTestFile(CHUNK_SIZE),
          createTestFile(MIB),
        ];
        const whole = createHash('sha256');
        const uploadUrl = `${alice.baseUrl}/remote.php/dav/uploads/${env.users.alice.user}/${randomUUID()}`;
        const target = alice.fileUrl('chunked.bin');

        const created = await alice.request(uploadUrl, {
          method: 'MKCOL',
          headers: { destination: target },
        });

        assert.equal(created.status, 201, 'MKCOL of the upload folder');

        for (const [index, chunk] of chunks.entries()) {
          for (const part of chunk.blocks()) {
            whole.update(part);
          }

          const name = String(index + 1).padStart(5, '0');
          const sent = await alice.request(`${uploadUrl}/${name}`, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunk.bytes),
              destination: target,
            },
            body: chunk.stream(),
          });

          assert.equal(sent.status, 201, `PUT of chunk ${name}`);
        }

        const assembled = await alice.request(`${uploadUrl}/.file`, {
          method: 'MOVE',
          headers: { destination: target },
          timeoutMs: 600_000,
        });
        const download = await fetchDigest(target, { basicAuth: alice.auth });

        assert.ok(
          assembled.status === 201 || assembled.status === 204,
          `MOVE of .file answered HTTP ${String(assembled.status)}`,
        );
        assert.equal(download.bytes, 2 * CHUNK_SIZE + MIB, 'size');
        assert.equal(download.sha256, whole.digest('hex'), 'checksum');
      },
    },
  ],
};
