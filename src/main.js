#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { uploadFile } from './upload.js';
import { zipFiles } from './zip.js';
import { copyToClipboard } from './clipboard.js';

const filePaths = process.argv.slice(2);

if (filePaths.length === 0) {
  console.error('Usage: magicode-uploader <file1> [file2] [file3] ...');
  process.exit(1);
}

for (const fp of filePaths) {
  const resolved = path.resolve(fp);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${resolved}`);
    process.exit(1);
  }
}

let fileToUpload;
let tempZipPath = null;

try {
  if (filePaths.length === 1) {
    fileToUpload = path.resolve(filePaths[0]);
  } else {
    const resolvedPaths = filePaths.map((fp) => path.resolve(fp));
    tempZipPath = await zipFiles(resolvedPaths);
    fileToUpload = tempZipPath;
  }

  try {
    const { showUploading } = await import('./notify.js');
    showUploading(path.basename(fileToUpload));
  } catch {}

  const result = await uploadFile(fileToUpload);

  if (!result.success) {
    try {
      const { showError } = await import('./notify.js');
      showError(new Error(result.error));
    } catch {}
    setTimeout(() => process.exit(1), 1000);
  }

  const clipResult = await copyToClipboard(result.downloadUrl);

  try {
    const { showSuccess } = await import('./notify.js');
    showSuccess(result.downloadUrl);
  } catch {}

  setTimeout(() => process.exit(0), 1000);
} catch (err) {
  try {
    const { showError } = await import('./notify.js');
    showError(err);
  } catch {}
  setTimeout(() => process.exit(1), 1000);
} finally {
  if (tempZipPath) {
    try { fs.unlinkSync(tempZipPath); } catch {}
  }
}
