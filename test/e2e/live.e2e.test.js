// Opt-in (`npm run test:live` or MAGICODE_LIVE=1): uploads to the real send.magicode.me and downloads
// the file back. Leaves a small random test file on the service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const enabled = process.env.MAGICODE_LIVE === '1' || process.env.npm_lifecycle_event === 'test:live';
const skip = !enabled && 'run `npm run test:live` to test against send.magicode.me';

test('multi-chunk upload round-trips through send.magicode.me', { skip, timeout: 180000 }, async () => {
  delete process.env.MAGICODE_BASE_URL;
  const { uploadFile, CHUNK_SIZE } = await import('../../src/upload.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-live-'));
  try {
    const data = crypto.randomBytes(CHUNK_SIZE + 4321);
    const file = path.join(dir, 'magicode-uploader-live-test.bin');
    fs.writeFileSync(file, data);

    const result = await uploadFile(file);
    assert.equal(result.success, true, result.error);
    assert.match(result.downloadUrl, /^https:\/\/send\.magicode\.me\/send-file\/file\/[0-9a-f]+\/view$/);

    const res = await fetch(result.downloadUrl.replace(/\/view$/, '/download'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /magicode-uploader-live-test\.bin/);
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.ok(downloaded.equals(data), 'downloaded bytes differ from the upload');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
