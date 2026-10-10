// Runs the real notifier processes (hidden PowerShell), with MAGICODE_NOTIFY_LOG
// so they log the message instead of showing a balloon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const notifyUrl = new URL('../../src/notify.js', import.meta.url).href;
const windowsOnly = { skip: process.platform !== 'win32' && 'needs Windows PowerShell' };

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-notify-'));
  return { file: path.join(dir, 'notify.log'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').trim().split(/\r?\n/) : []);

// Runs `body` in a separate node process that exits right after it, exactly
// like main.js does - this is where the notifier used to get killed.
function runInChild(logFile, body) {
  const script = `import * as n from ${JSON.stringify(notifyUrl)};\n${body}\nprocess.exit(0);`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, MAGICODE_NOTIFY_LOG: logFile },
    encoding: 'utf-8',
    timeout: 30000,
  });
}

test('notifications are delivered, in order, with non-ASCII text intact', windowsOnly, () => {
  const log = tempLog();
  try {
    const r = runInChild(log.file, `
      n.showUploading('סיכום פגישה.txt');
      await new Promise((r) => setTimeout(r, 300));
      n.showSuccess('https://example.test/view', true);
      await n.waitForNotifications();`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readLines(log.file), [
      'Info Uploading סיכום פגישה.txt...',
      'Info Upload complete! Link copied to clipboard: https://example.test/view',
    ]);
  } finally {
    log.cleanup();
  }
});

test('errors and clipboard failures use the right wording', windowsOnly, () => {
  const log = tempLog();
  try {
    const r = runInChild(log.file, `
      n.showError(new Error('boom'));
      n.showSuccess('https://example.test/view', false);
      await n.waitForNotifications();`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readLines(log.file).sort(), [
      'Error Upload failed: boom',
      'Info Upload complete (copying to the clipboard failed): https://example.test/view',
    ].sort());
  } finally {
    log.cleanup();
  }
});

test('regression: exiting without waiting kills the notifier (why main.js waits)', windowsOnly, () => {
  // Documents the platform behaviour the waitForNotifications() call guards
  // against: node kills its (non-detached) children when it exits.
  const log = tempLog();
  try {
    const r = runInChild(log.file, `n.showUploading('lost.txt');`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readLines(log.file), []);
  } finally {
    log.cleanup();
  }
});

test('multi-line and quote characters cannot break out of the script', windowsOnly, () => {
  const log = tempLog();
  try {
    const r = runInChild(log.file, `
      n.showUploading("it's \\"quoted\\"\\r\\nnext line $(calc) %PATH%");
      await n.waitForNotifications();`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readLines(log.file), [`Info Uploading it's "quoted" next line $(calc) %PATH%...`]);
  } finally {
    log.cleanup();
  }
});

test('waitForNotifications resolves immediately when nothing was shown', async () => {
  const { waitForNotifications } = await import(notifyUrl);
  const t0 = Date.now();
  await waitForNotifications();
  assert.ok(Date.now() - t0 < 500);
});
