// The installed layout must match what the pieces expect of each other:
// the DLL launches MagicodeUploader.exe from its own folder, and the package
// manifest points at the DLL and the exe by path relative to the install folder.
// Regression: v1.2.0's installer missed a file the app needed, so it crashed after a fresh install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

// Every file the installed app needs, relative to the install folder.
const manifest = read('AppxManifest.xml');
const dllInManifest = /<com:Class [^>]*Path="([^"]+)"/.exec(manifest)[1];
const exeInManifest = /<Application [^>]*Executable="([^"]+)"/.exec(manifest)[1];
const REQUIRED = ['MagicodeUploader.exe', 'MagicodeNative.dll', 'AppxManifest.xml', 'scripts\\register-win11.ps1'];

/** Install-folder-relative paths of the files an Inno Setup script installs. */
function issInstalled() {
  const out = [];
  for (const m of read('scripts/installer.iss').matchAll(/^Source:\s*"([^"]+)";\s*DestDir:\s*"\{app\}\\?([^"]*)"/gm)) {
    const dest = m[2] ? `${m[2]}\\` : '';
    out.push(dest + path.win32.basename(m[1]));
  }
  return out;
}

test('the DLL looks for the exe in its own folder', () => {
  assert.match(read('src/win11/MagicodeContextMenu.cpp'), /ModuleDir\(\) \+ L"\\\\MagicodeUploader\.exe"/);
});

test('the package manifest points at the installed DLL and exe', () => {
  assert.equal(dllInManifest, 'MagicodeNative.dll');
  assert.equal(exeInManifest, 'MagicodeUploader.exe');
});

test('the Inno Setup installer installs every required file where it is expected', () => {
  const installed = issInstalled();
  for (const f of REQUIRED) assert.ok(installed.includes(f), `installer.iss does not install ${f} (installs: ${installed})`);
  assert.match(read('scripts/installer.iss'), /Source:\s*"\.\.\\Assets\\\*";\s*DestDir:\s*"\{app\}\\Assets"/);
});

test('install.ps1 copies every required file where it is expected', () => {
  const ps1 = read('scripts/install.ps1');
  assert.match(ps1, /Copy-Item \$exe "\$InstallDir\\"/);
  assert.match(ps1, /Copy-Item \$dll "\$InstallDir\\"/);
  assert.match(ps1, /Copy-Item "\$SourceRoot\\AppxManifest\.xml" "\$InstallDir\\"/);
  assert.match(ps1, /Copy-Item "\$SourceRoot\\scripts\\register-win11\.ps1" "\$InstallDir\\scripts\\"/);
});

test('the registration script and the uninstaller agree on the DLL location', () => {
  assert.match(read('scripts/register-win11.ps1'), /Join-Path \$AppDir 'MagicodeNative\.dll'/);
  assert.match(read('scripts/uninstall.ps1'), /\$installDir\\MagicodeUploader\.exe/);
});

test('version numbers agree', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(read('src/MagicodeUploader/MagicodeUploader.csproj'), new RegExp(`<Version>${version}</Version>`));
  assert.match(read('scripts/installer.iss'), new RegExp(`#define MyAppVersion "${version}"`));
  assert.match(manifest, new RegExp(`Version="${version}\\.0"`));
});
