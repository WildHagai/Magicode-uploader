import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_KEY = 'HKCU\\Software\\Classes\\*\\shell\\MagicodeUpload';
const DIR_KEY = 'HKCU\\Software\\Classes\\Directory\\shell\\MagicodeUpload';

/**
 * Register magicode-uploader in the Windows Explorer context menu.
 *
 * Creates registry entries under HKCU so that right-clicking a file or
 * directory shows an "Upload to Magicode" option.
 */
export async function register() {
  const launcherPath = path.resolve(__dirname, 'launcher.vbs');

  // Use wscript.exe with the VBS launcher to run node.exe hidden (no console window).
  // %1 is replaced by the shell with the selected file/directory path.
  const command = `wscript.exe "${launcherPath}" "%1"`;

  // Escape inner double quotes so reg add parses the /d value correctly.
  const escapedCommand = command.replace(/"/g, '\\"');

  try {
    // ── Single-file context menu ──────────────────────────────────────
    execSync(
      `reg add "${FILE_KEY}" /ve /d "Upload to Magicode" /f`,
      { stdio: 'pipe' },
    );
    execSync(
      `reg add "${FILE_KEY}" /v Icon /d "imageres.dll,112" /f`,
      { stdio: 'pipe' },
    );
    execSync(
      `reg add "${FILE_KEY}\\command" /ve /d "${escapedCommand}" /f`,
      { stdio: 'pipe' },
    );

    // Multi-file selection support (Windows Player multi-select model)
    execSync(
      `reg add "${FILE_KEY}" /v MultiSelectModel /d "Player" /f`,
      { stdio: 'pipe' },
    );

    // ── Directory context menu ────────────────────────────────────────
    execSync(
      `reg add "${DIR_KEY}" /ve /d "Upload to Magicode" /f`,
      { stdio: 'pipe' },
    );
    execSync(
      `reg add "${DIR_KEY}" /v Icon /d "imageres.dll,112" /f`,
      { stdio: 'pipe' },
    );
    execSync(
      `reg add "${DIR_KEY}\\command" /ve /d "${escapedCommand}" /f`,
      { stdio: 'pipe' },
    );

    console.log('Context menu registered successfully.');
    console.log(`  launcher: ${launcherPath}`);
  } catch (err) {
    console.error(`Failed to register context menu: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Remove magicode-uploader context menu entries from the Windows registry.
 */
export async function unregister() {
  try {
    execSync(`reg delete "${FILE_KEY}" /f`, { stdio: 'pipe' });
  } catch {
    // Key may not exist -- that is fine.
  }

  try {
    execSync(`reg delete "${DIR_KEY}" /f`, { stdio: 'pipe' });
  } catch {
    // Key may not exist -- that is fine.
  }

  console.log('Context menu entries removed.');
}

// ── CLI entry point ─────────────────────────────────────────────────────
if (process.argv.includes('--install')) {
  await register();
} else if (process.argv.includes('--uninstall')) {
  await unregister();
}
