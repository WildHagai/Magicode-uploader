// Every module the app loads must be shipped by each way of installing it.
// Regression: v1.2.0's installer listed src files by name and missed args.js,
// so main.js crashed on startup after a fresh install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

/** src files reachable from main.js through relative imports. */
function runtimeModules() {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    for (const m of src.matchAll(/(?:import|from)\s*\(?\s*['"](\.\/[^'"]+)['"]/g)) {
      visit(path.posix.join(path.posix.dirname(rel), m[1]));
    }
  };
  visit('src/main.js');
  return [...seen];
}

test('main.js imports are all found (sanity check of the scanner)', () => {
  const mods = runtimeModules();
  for (const m of ['src/main.js', 'src/upload.js', 'src/zip.js', 'src/clipboard.js', 'src/notify.js', 'src/args.js']) {
    assert.ok(mods.includes(m), `${m} not found in ${mods}`);
  }
});

test('the Inno Setup installer ships every runtime module', () => {
  const iss = read('scripts/installer.iss');
  const shipsAll = /Source:\s*"\.\.\\src\\\*\.js";\s*DestDir:\s*"\{app\}\\src"/.test(iss);
  for (const m of runtimeModules()) {
    const listed = iss.includes(`"..\\${m.replace(/\//g, '\\')}"`);
    assert.ok(shipsAll || listed, `installer.iss does not ship ${m}`);
  }
});

test('install.ps1 copies every runtime module', () => {
  const ps1 = read('scripts/install.ps1');
  assert.match(ps1, /Copy-Item "\$SourceRoot\\src\\\*\.js" "\$InstallDir\\src\\"/);
});

test('the release zip (pack.js) includes every runtime module', () => {
  const pack = read('scripts/pack.js');
  assert.match(pack, /readdirSync\(path\.join\(root, 'src'\)\)\.filter\(\(f\) => f\.endsWith\('\.js'\)\)/);
});
