// End-to-end: runs `node src/main.js` as a separate process against the mock
// server, with real zipping, real notifier processes and the real clipboard.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer } from '../helpers/mock-server.js';
import { readZip } from '../helpers/zip-reader.js';
import { readClipboard, writeClipboard } from '../helpers/clipboard.js';

const MAIN = fileURLToPath(new URL('../../src/main.js', import.meta.url));
const SENTINEL = 'magicode-e2e-clipboard-sentinel';

let server;
let dir;
let savedClipboard;

before(async () => {
  server = await startMockServer();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-e2e-'));
  savedClipboard = readClipboard();
});

after(async () => {
  writeClipboard(savedClipboard);
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  server.state.failDataUploads = 0;
  server.state.okFalse = false;
  writeClipboard(SENTINEL);
});

/** Runs the CLI; resolves with exit code, output, notifications and log lines. */
function runCli(args, extraEnv = {}) {
  const notifyLog = path.join(dir, `notify-${crypto.randomUUID()}.log`);
  const appLog = path.join(dir, `app-${crypto.randomUUID()}.log`);
  return new Promise((resolve) => {
    execFile(process.execPath, [MAIN, ...args], {
      env: {
        ...process.env,
        MAGICODE_BASE_URL: server.url,
        MAGICODE_NOTIFY_LOG: notifyLog,
        MAGICODE_LOG_PATH: appLog,
        MAGICODE_RETRY_DELAY_MS: '5',
        ...extraEnv,
      },
      encoding: 'utf-8',
      timeout: 60000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split(/\r?\n/) : []);
      resolve({
        code: err ? err.code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        notifications: lines(notifyLog),
        log: lines(appLog),
      });
    });
  });
}

function write(rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('single file: uploads it, prints and copies the link, notifies once', async () => {
  const data = crypto.randomBytes(5000);
  const file = write('single/report.pdf', data);

  const r = await runCli([file]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^http:\/\/127\.0\.0\.1:\d+\/send-file\/file\/[0-9a-f]+\/view$/);

  const received = server.upload(r.stdout);
  assert.equal(received.filename, 'report.pdf');
  assert.ok(received.bytes.equals(data));

  assert.equal(readClipboard().trim(), r.stdout);
  // A fast upload skips "Uploading..." so the result isn't queued behind it.
  assert.deepEqual(r.notifications, [`Info Upload complete! Link copied to clipboard: ${r.stdout}`]);
  assert.match(r.log.at(-1), /uploaded .*report\.pdf -> /);
});

test('slow upload: "Uploading..." first, then the result', async () => {
  const file = write('slow/notes.txt', 'notes');

  const r = await runCli([file], { MAGICODE_UPLOADING_DELAY_MS: '0' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.notifications, [
    'Info Uploading notes.txt...',
    `Info Upload complete! Link copied to clipboard: ${r.stdout}`,
  ]);
});

test('large file: uploaded in chunks and reassembled byte-for-byte', async () => {
  const data = crypto.randomBytes(5 * 1024 * 1024 + 7);
  const file = write('large/video.bin', data);

  const r = await runCli([file]);
  assert.equal(r.code, 0, r.stderr);
  const received = server.upload(r.stdout);
  assert.equal(received.chunks.length, 3);
  assert.ok(received.bytes.equals(data));
});

test('folder: zipped as <folder>.zip with its structure', async () => {
  write('תיקייה/a.txt', 'a');
  write('תיקייה/sub/b.txt', 'b');

  const r = await runCli([path.join(dir, 'תיקייה')]);
  assert.equal(r.code, 0, r.stderr);
  const received = server.upload(r.stdout);
  assert.equal(received.filename, 'תיקייה.zip');
  const entries = readZip(received.bytes);
  assert.equal(entries['תיקייה/a.txt'].toString(), 'a');
  assert.equal(entries['תיקייה/sub/b.txt'].toString(), 'b');
});

test('several items: one upload, a zip named after the parent folder', async () => {
  const a = write('Invoices/jan.pdf', 'jan');
  const b = write('Invoices/feb.pdf', 'feb');
  write('Invoices/scans/one.png', 'png');

  const r = await runCli([a, b, path.join(dir, 'Invoices', 'scans')]);
  assert.equal(r.code, 0, r.stderr);
  const received = server.upload(r.stdout);
  assert.equal(received.filename, 'Invoices.zip');
  const files = Object.keys(readZip(received.bytes)).filter((n) => !n.endsWith('/')).sort();
  assert.deepEqual(files, ['feb.pdf', 'jan.pdf', 'scans/one.png']);
  assert.equal(server.uploads.size >= 1, true);
});

test('--list file (how the context menu passes the selection)', async () => {
  const a = write('list/מסמך א.txt', 'one');
  const b = write('list/second file.txt', 'two');
  const list = write(`menu-${crypto.randomUUID()}.txt`, `${a}\n${b}\n`);

  const r = await runCli(['--list', list]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.existsSync(list), false, 'list file should be deleted');
  const entries = readZip(server.upload(r.stdout).bytes);
  assert.equal(entries['מסמך א.txt'].toString(), 'one');
  assert.equal(entries['second file.txt'].toString(), 'two');
});

test('server failure: exit 1, error notification, clipboard untouched', async () => {
  // Regression: a failed upload used to copy "undefined" and claim success.
  const file = write('failing/x.txt', 'x');
  server.state.failDataUploads = 100;

  const r = await runCli([file]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(readClipboard().trim(), SENTINEL);
  assert.equal(r.notifications.length, 1);
  assert.match(r.notifications[0], /^Error Upload failed: data-upload at byte 0 failed/);
});

test('missing file: exit 1 with an error notification', async () => {
  const r = await runCli([path.join(dir, 'does-not-exist.txt')]);
  assert.equal(r.code, 1);
  assert.equal(readClipboard().trim(), SENTINEL);
  assert.deepEqual(r.notifications.map((n) => n.split(':')[0]), ['Error Upload failed']);
  assert.match(r.notifications[0], /File not found/);
});

test('empty file: clear error, nothing sent', async () => {
  const file = write('empty/blank.txt', '');
  const requests = server.state.requests.length;

  const r = await runCli([file]);
  assert.equal(r.code, 1);
  assert.match(r.notifications.at(-1), /^Error Upload failed: blank\.txt is empty/);
  assert.equal(server.state.requests.length, requests);
});

test('no arguments: usage message, exit 1', async () => {
  const r = await runCli([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Usage:/);
});

test('temporary zips are cleaned up', async () => {
  // zip.js creates its archive in mkdtemp('magicode-'): "magicode-" + 6 characters.
  const zipDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => /^magicode-[A-Za-z0-9]{6}$/.test(n));
  const before = zipDirs();
  write('cleanup/dir/a.txt', 'a');

  const r = await runCli([path.join(dir, 'cleanup', 'dir')]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(zipDirs().filter((n) => !before.includes(n)), []);
});
