// Opt-in (`npm run test:shell` or MAGICODE_SHELL_E2E=1): drives the *installed* context menu through
// the Windows shell, exactly as Explorer invokes it, and checks the upload log.
// Uploads small test files to the real send.magicode.me.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClipboard, writeClipboard } from '../helpers/clipboard.js';

const enabled = process.env.MAGICODE_SHELL_E2E === '1' || process.env.npm_lifecycle_event === 'test:shell';
const skip = (process.platform !== 'win32' || !enabled)
  && 'run `npm run test:shell` on Windows with Magicode Uploader installed';
const APP = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'MagicodeUploader');
const LOG = path.join(APP, 'upload.log');
const VERB = 'Upload to Magicode';

let dir;
let savedClipboard;

function ps(script) {
  // UTF-16 encoded so non-ASCII paths survive; output comes back as base64 UTF-8.
  const wrapped = `$r = & { ${script} } | Out-String; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($r))`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(wrapped, 'utf16le').toString('base64')],
  { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return Buffer.from(out.trim(), 'base64').toString('utf-8').trim();
}

const q = (s) => `'${s.replace(/'/g, "''")}'`;
// Explorer loads packaged verbs asynchronously, so the first query on a new
// item can miss them all; poll until the menu settles, then count.
const verbCount = (folder, name) => Number(ps(
  `$i = (New-Object -ComObject Shell.Application).Namespace(${q(folder)}).ParseName(${q(name)}); ` +
  `for ($t = 0; $t -lt 20; $t++) { ` +
  `  $c = @($i.Verbs() | Where-Object { $_.Name -eq ${q(VERB)} }).Count; if ($c -gt 0) { break }; Start-Sleep -Milliseconds 500 }; ` +
  `Start-Sleep -Milliseconds 500; @($i.Verbs() | Where-Object { $_.Name -eq ${q(VERB)} }).Count`));

async function waitForLogLine(match, timeoutMs = 60000) {
  const start = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (!fs.existsSync(LOG) || fs.statSync(LOG).size <= start) continue;
    const added = fs.readFileSync(LOG).subarray(start).toString('utf-8');
    const line = added.split('\n').find((l) => match.test(l));
    if (line) return line;
  }
  return null;
}

before(() => {
  if (skip) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-shell-'));
  savedClipboard = readClipboard();
});

after(() => {
  if (skip) return;
  writeClipboard(savedClipboard);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command appears exactly once on files and folders', { skip }, () => {
  // Regression: the static registry verb used to duplicate the packaged one.
  fs.writeFileSync(path.join(dir, 'once.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'folder-once'));
  assert.equal(verbCount(dir, 'once.txt'), 1);
  assert.equal(verbCount(dir, 'folder-once'), 1);
});

test('invoking it on a file uploads that file and copies the link', { skip, timeout: 90000 }, async () => {
  const name = `קובץ בדיקה ${Date.now()}.txt`;
  fs.writeFileSync(path.join(dir, name), 'shell e2e');

  const pending = waitForLogLine(new RegExp(`uploaded .*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -> (https://\\S+)`));
  ps(`$i = (New-Object -ComObject Shell.Application).Namespace(${q(dir)}).ParseName(${q(name)}); ` +
     `($i.Verbs() | Where-Object { $_.Name -eq ${q(VERB)} }).DoIt()`);
  const line = await pending;
  assert.ok(line, 'no upload logged within 60s');

  const url = /-> (https:\/\/\S+)/.exec(line)[1];
  assert.equal(readClipboard().trim(), url);
});

test('invoking it on a multi-selection uploads one zip', { skip, timeout: 90000 }, async () => {
  const sel = path.join(dir, `selection ${Date.now()}`);
  fs.mkdirSync(sel);
  for (const n of ['one.txt', 'two.txt', 'three.txt']) fs.writeFileSync(path.join(sel, n), n);

  const pending = waitForLogLine(new RegExp(`uploaded .*${path.basename(sel)}\\.zip -> `));
  ps(`$items = (New-Object -ComObject Shell.Application).Namespace(${q(sel)}).Items(); ` +
     `($items.Verbs() | Where-Object { $_.Name -eq ${q(VERB)} }).DoIt()`);
  assert.ok(await pending, 'no zip upload logged within 60s');
});
