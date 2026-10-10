import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockServer } from '../helpers/mock-server.js';

let server;
let upload; // the module, imported after MAGICODE_BASE_URL is set
let dir;

before(async () => {
  server = await startMockServer();
  process.env.MAGICODE_BASE_URL = server.url;
  process.env.MAGICODE_RETRY_DELAY_MS = '5';
  upload = await import('../../src/upload.js');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-upload-'));
});

after(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  server.state.failDataUploads = 0;
  server.state.okFalse = false;
});

function makeFile(name, size) {
  const file = path.join(dir, name);
  const data = crypto.randomBytes(size);
  fs.writeFileSync(file, data);
  return { file, data };
}

test('uploads a small file and returns the view URL for its keyFile', async () => {
  const { file, data } = makeFile('small.txt', 100);
  const result = await upload.uploadFile(file);

  assert.equal(result.success, true, result.error);
  assert.match(result.downloadUrl, /\/send-file\/file\/[0-9a-f]+\/view$/);
  const received = server.upload(result.downloadUrl);
  assert.equal(received.filename, 'small.txt');
  assert.equal(received.size, 100);
  assert.deepEqual(received.bytes, data);
});

test('sends the original (non-ASCII) file name in prep-upload', async () => {
  const { file } = makeFile('סיכום פגישה.txt', 10);
  const result = await upload.uploadFile(file);
  assert.equal(server.upload(result.downloadUrl).filename, 'סיכום פגישה.txt');
});

test('uploads large files in CHUNK_SIZE pieces at consecutive positions', async () => {
  const size = 2 * upload.CHUNK_SIZE + 123;
  const { file, data } = makeFile('big.bin', size);
  const progress = [];
  const result = await upload.uploadFile(file, (p) => progress.push(p.uploaded));

  assert.equal(result.success, true, result.error);
  const received = server.upload(result.downloadUrl);
  assert.deepEqual(received.chunks, [
    { position: 0, length: upload.CHUNK_SIZE },
    { position: upload.CHUNK_SIZE, length: upload.CHUNK_SIZE },
    { position: 2 * upload.CHUNK_SIZE, length: 123 },
  ]);
  assert.ok(received.bytes.equals(data), 'reassembled bytes differ from the source file');
  assert.deepEqual(progress, [upload.CHUNK_SIZE, 2 * upload.CHUNK_SIZE, size]);
});

test('retries a failed chunk and still completes', async () => {
  const { file, data } = makeFile('retry.bin', 1000);
  server.state.failDataUploads = upload.CHUNK_ATTEMPTS - 1;

  const result = await upload.uploadFile(file);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(server.upload(result.downloadUrl).bytes, data);
});

test('gives up after CHUNK_ATTEMPTS failures of the same chunk', async () => {
  const { file } = makeFile('fail.bin', 1000);
  server.state.failDataUploads = upload.CHUNK_ATTEMPTS;

  const result = await upload.uploadFile(file);
  assert.equal(result.success, false);
  assert.match(result.error, /data-upload at byte 0 failed \(HTTP 500\)/);
});

test('reports a server ok=false answer as a failure', async () => {
  const { file } = makeFile('okfalse.bin', 10);
  server.state.okFalse = true;

  const result = await upload.uploadFile(file);
  assert.equal(result.success, false);
  assert.match(result.error, /data-upload/);
});

test('rejects empty files before contacting the server', async () => {
  const { file } = makeFile('empty.bin', 0);
  const before = server.state.requests.length;

  const result = await upload.uploadFile(file);
  assert.equal(result.success, false);
  assert.match(result.error, /empty/);
  assert.equal(server.state.requests.length, before, 'no request should be sent for an empty file');
});

test('reports a missing file and a directory clearly', async () => {
  const missing = await upload.uploadFile(path.join(dir, 'nope.txt'));
  assert.equal(missing.success, false);
  assert.match(missing.error, /File not found/);

  const folder = await upload.uploadFile(dir);
  assert.equal(folder.success, false);
  assert.match(folder.error, /not a file/);
});
