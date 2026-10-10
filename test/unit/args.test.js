import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArgs, zipNameFor } from '../../src/args.js';

test('readArgs passes plain arguments through', () => {
  assert.deepEqual(readArgs(['a.txt', 'b c.txt']), ['a.txt', 'b c.txt']);
  assert.deepEqual(readArgs([]), []);
});

test('readArgs reads a --list file (UTF-8, BOM, CRLF, blank lines) and deletes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-args-'));
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, '\uFEFFC:\\a\\קובץ.txt\r\nC:\\b\\two words.pdf\r\n\r\n', 'utf-8');

  assert.deepEqual(readArgs(['--list', list]), ['C:\\a\\קובץ.txt', 'C:\\b\\two words.pdf']);
  assert.equal(fs.existsSync(list), false, 'list file should be deleted after reading');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readArgs treats a bare --list as a file name', () => {
  assert.deepEqual(readArgs(['--list']), ['--list']);
});

test('zipNameFor: a single folder is named after the folder', () => {
  assert.equal(zipNameFor(['C:\\photos\\תיקייה']), 'תיקייה.zip');
});

test('zipNameFor: several items are named after their parent folder', () => {
  assert.equal(zipNameFor(['C:\\work\\Invoices\\a.pdf', 'C:\\work\\Invoices\\b.pdf']), 'Invoices.zip');
});

test('zipNameFor: a drive root still gets a usable name', () => {
  assert.equal(zipNameFor(['D:\\']), 'D.zip');
  assert.equal(zipNameFor(['D:\\a.txt', 'D:\\b.txt']), 'D.zip');
});
