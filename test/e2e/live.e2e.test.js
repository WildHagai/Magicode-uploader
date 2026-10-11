// Opt-in (`npm run test:live` or MAGICODE_LIVE=1): uploads to the real send.magicode.me with the
// built exe and downloads the file back. Leaves a small random test file on the service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClipboard, writeClipboard } from '../helpers/clipboard.js';

const enabled = process.env.MAGICODE_LIVE === '1' || process.env.npm_lifecycle_event === 'test:live';
const skip = !enabled && 'run `npm run test:live` to test against send.magicode.me';

test('multi-chunk upload round-trips through send.magicode.me', { skip, timeout: 180000 }, async () => {
  const { EXE } = await import('../helpers/exe.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-live-'));
  const savedClipboard = readClipboard();
  try {
    const data = crypto.randomBytes(2 * 1024 * 1024 + 4321);
    const file = path.join(dir, 'magicode-uploader-live-test.bin');
    fs.writeFileSync(file, data);

    const env = { ...process.env, MAGICODE_NOTIFY_LOG: path.join(dir, 'notify.log'), MAGICODE_LOG_PATH: path.join(dir, 'app.log') };
    delete env.MAGICODE_BASE_URL;
    const url = execFileSync(EXE, [file], { env, encoding: 'utf-8', timeout: 170000, windowsHide: true }).trim();
    assert.match(url, /^https:\/\/send\.magicode\.me\/send-file\/file\/[0-9a-f]+\/view$/);

    const res = await fetch(url.replace(/\/view$/, '/download'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /magicode-uploader-live-test\.bin/);
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.ok(downloaded.equals(data), 'downloaded bytes differ from the upload');
  } finally {
    writeClipboard(savedClipboard);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
