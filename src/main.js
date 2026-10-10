#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadFile } from './upload.js';
import { zipFiles } from './zip.js';
import { copyToClipboard } from './clipboard.js';
import { showUploading, showSuccess, showError, waitForNotifications } from './notify.js';
import { readArgs, zipNameFor } from './args.js';

const UPLOADING_DELAY_MS = Number(process.env.MAGICODE_UPLOADING_DELAY_MS ?? 1500);
const LOG_PATH = process.env.MAGICODE_LOG_PATH
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'upload.log');

function log(message) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

async function main() {
  const paths = readArgs(process.argv.slice(2)).map((p) => path.resolve(p));

  if (paths.length === 0) {
    console.error('Usage: magicode-uploader <file-or-folder> [more...]');
    return 1;
  }

  for (const p of paths) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  }

  const needsZip = paths.length > 1 || fs.statSync(paths[0]).isDirectory();
  const label = needsZip
    ? `${zipNameFor(paths)} (compressing ${paths.length} item${paths.length > 1 ? 's' : ''})`
    : path.basename(paths[0]);

  // Windows shows tray balloons one at a time, so an "Uploading..." balloon
  // would hold back the result by several seconds. Only show it for slow uploads.
  const uploadingTimer = setTimeout(() => showUploading(label), UPLOADING_DELAY_MS);

  let tempZipPath = null;
  try {
    let fileToUpload = paths[0];
    if (needsZip) {
      tempZipPath = await zipFiles(paths, zipNameFor(paths));
      fileToUpload = tempZipPath;
    }

    const result = await uploadFile(fileToUpload);
    if (!result.success) throw new Error(result.error);

    const clip = await copyToClipboard(result.downloadUrl);
    if (!clip.success) log(`clipboard failed: ${clip.error}`);

    console.log(result.downloadUrl);
    log(`uploaded ${fileToUpload} -> ${result.downloadUrl}`);
    showSuccess(result.downloadUrl, clip.success);
    return 0;
  } finally {
    clearTimeout(uploadingTimer);
    if (tempZipPath) {
      fs.rmSync(path.dirname(tempZipPath), { recursive: true, force: true });
    }
  }
}

let exitCode;
try {
  exitCode = await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  log(`error: ${err.stack || err.message}`);
  showError(err);
  exitCode = 1;
}
await waitForNotifications();
process.exit(exitCode);
