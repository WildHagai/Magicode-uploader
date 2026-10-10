import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipFiles } from '../../src/zip.js';
import { readZip } from '../helpers/zip-reader.js';

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magicode-zip-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(dir, 'קובץ.txt'), 'שלום');
  fs.mkdirSync(path.join(dir, 'תיקייה', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'תיקייה', 'in.txt'), 'inside');
  fs.writeFileSync(path.join(dir, 'תיקייה', 'sub', 'deep.txt'), 'deep');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

function cleanup(zipPath) {
  fs.rmSync(path.dirname(zipPath), { recursive: true, force: true });
}

test('zips files under their base names, with the requested archive name', async () => {
  const zipPath = await zipFiles([path.join(dir, 'a.txt'), path.join(dir, 'קובץ.txt')], 'bundle.zip');
  try {
    assert.equal(path.basename(zipPath), 'bundle.zip');
    const entries = readZip(fs.readFileSync(zipPath));
    assert.deepEqual(Object.keys(entries).sort(), ['a.txt', 'קובץ.txt'].sort());
    assert.equal(entries['a.txt'].toString(), 'alpha');
    assert.equal(entries['קובץ.txt'].toString('utf-8'), 'שלום');
  } finally {
    cleanup(zipPath);
  }
});

test('zips folders recursively under the folder name', async () => {
  const zipPath = await zipFiles([path.join(dir, 'תיקייה')], 'תיקייה.zip');
  try {
    const entries = readZip(fs.readFileSync(zipPath));
    assert.equal(entries['תיקייה/in.txt'].toString(), 'inside');
    assert.equal(entries['תיקייה/sub/deep.txt'].toString(), 'deep');
  } finally {
    cleanup(zipPath);
  }
});

test('mixes files and folders in one archive', async () => {
  const zipPath = await zipFiles([path.join(dir, 'a.txt'), path.join(dir, 'תיקייה')], 'mixed.zip');
  try {
    const files = Object.keys(readZip(fs.readFileSync(zipPath))).filter((n) => !n.endsWith('/'));
    assert.deepEqual(files.sort(), ['a.txt', 'תיקייה/in.txt', 'תיקייה/sub/deep.txt'].sort());
  } finally {
    cleanup(zipPath);
  }
});

test('each archive gets its own temp directory', async () => {
  const one = await zipFiles([path.join(dir, 'a.txt')], 'same.zip');
  const two = await zipFiles([path.join(dir, 'a.txt')], 'same.zip');
  try {
    assert.notEqual(path.dirname(one), path.dirname(two));
  } finally {
    cleanup(one);
    cleanup(two);
  }
});

test('rejects missing paths and empty input', async () => {
  await assert.rejects(zipFiles([path.join(dir, 'nope.txt')], 'x.zip'), /not found/);
  await assert.rejects(zipFiles([], 'x.zip'), /non-empty/);
});
