#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadFile } from './upload.js';
import { zipFiles } from './zip.js';
import { copyToClipboard } from './clipboard.js';
import { showUploading, showSuccess, showError, finishNotifications } from './notify.js';

const LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'upload.log');

function log(message) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

/**
 * Paths come either directly on the command line, or (from the Explorer
 * context menu) as `--list <file>`: a UTF-8 file with one path per line,
 * which avoids the command-line length limit on large selections.
 */
function readArgs(argv) {
  if (argv[0] === '--list' && argv[1]) {
    const listFile = argv[1];
    const text = fs.readFileSync(listFile, 'utf-8').replace(/^﻿/, '');
    try { fs.unlinkSync(listFile); } catch {}
    return text.split(/\r?\n/).filter(Boolean);
  }
  return argv;
}

/** Name for the archive when more than one item, or a folder, is uploaded. */
function zipNameFor(paths) {
  const nameOf = (p) => path.basename(p) || p.replace(/[:\\/]/g, '') || 'files';
  const base = paths.length === 1 ? nameOf(paths[0]) : nameOf(path.dirname(paths[0]));
  return `${base}.zip`;
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

  let tempZipPath = null;
  try {
    let fileToUpload = paths[0];
    if (paths.length > 1 || fs.statSync(paths[0]).isDirectory()) {
      showUploading(`${zipNameFor(paths)} (compressing ${paths.length} item${paths.length > 1 ? 's' : ''})`);
      tempZipPath = await zipFiles(paths, zipNameFor(paths));
      fileToUpload = tempZipPath;
    } else {
      showUploading(path.basename(fileToUpload));
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
await finishNotifications();
process.exit(exitCode);
