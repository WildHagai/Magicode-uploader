// Read/restore the Windows clipboard so tests that copy URLs leave it as they found it.
import { execFileSync } from 'node:child_process';

function ps(command, input) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    input, encoding: 'utf-8', windowsHide: true,
  });
}

export function readClipboard() {
  // Get-Clipboard returns nothing when another process (e.g. Windows clipboard
  // history reacting to the copy) has the clipboard open, so retry an empty read.
  // Base64 round-trip so non-ASCII text survives the console code page.
  const b64 = ps(
    'for ($i = 0; $i -lt 10; $i++) { $t = Get-Clipboard -Raw; if ($t) { break }; Start-Sleep -Milliseconds 200 }; ' +
    'if ($t) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)) }',
  ).trim();
  return b64 ? Buffer.from(b64, 'base64').toString('utf-8') : '';
}

export function writeClipboard(text) {
  const b64 = Buffer.from(text ?? '', 'utf-8').toString('base64');
  ps(`$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); if ($t) { Set-Clipboard -Value $t } else { Set-Clipboard -Value $null }`);
}
