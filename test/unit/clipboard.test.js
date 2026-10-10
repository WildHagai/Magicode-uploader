import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from '../../src/clipboard.js';
import { readClipboard, writeClipboard } from '../helpers/clipboard.js';

test('copies text to the Windows clipboard', { skip: process.platform !== 'win32' && 'needs clip.exe' }, async () => {
  const saved = readClipboard();
  try {
    const url = `https://send.magicode.me/send-file/file/${Date.now()}/view`;
    const result = await copyToClipboard(url);
    assert.deepEqual(result, { success: true });
    assert.equal(readClipboard().trim(), url);
  } finally {
    writeClipboard(saved);
  }
});
