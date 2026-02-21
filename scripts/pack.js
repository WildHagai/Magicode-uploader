#!/usr/bin/env node

/**
 * Pack magicode-uploader into a distributable zip for installation.
 * Usage: node scripts/pack.js
 * Output: dist/MagicodeUploader-x64.zip
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

const FILES = [
  'src/main.js',
  'src/upload.js',
  'src/zip.js',
  'src/clipboard.js',
  'src/notify.js',
  'src/registry.js',
  'src/launcher.vbs',
  'src/win11/build/MagicodeNative.dll',
  'AppxManifest.xml',
  'MagicodeUploader.exe',
  'Assets/logo.png',
  'Assets/Square150x150Logo.png',
  'Assets/Square44x44Logo.png',
  'package.json',
  'scripts/install.ps1',
  'scripts/uninstall.ps1',
];

// Check that native DLL exists
const dllPath = path.join(root, 'src/win11/build/MagicodeNative.dll');
if (!fs.existsSync(dllPath)) {
  console.error('ERROR: MagicodeNative.dll not found. Build it first:');
  console.error('  npm run build:dll');
  process.exit(1);
}

// Check all files exist
for (const file of FILES) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error(`ERROR: Missing file: ${file}`);
    process.exit(1);
  }
}

// Create dist directory
fs.mkdirSync(distDir, { recursive: true });

const zipPath = path.join(distDir, 'MagicodeUploader-x64.zip');
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`Packed: ${zipPath} (${sizeMB} MB)`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

// Add application files under MagicodeUploader/ prefix
for (const file of FILES) {
  archive.file(path.join(root, file), { name: `MagicodeUploader/${file}` });
}

// Add node_modules
const nmDir = path.join(root, 'node_modules');
if (fs.existsSync(nmDir)) {
  archive.directory(nmDir, 'MagicodeUploader/node_modules');
}

archive.finalize();
