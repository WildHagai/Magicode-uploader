import { spawn } from 'node:child_process';

const pending = [];

/**
 * Show a tray balloon (a toast on Windows 11) from a short-lived hidden
 * PowerShell process. The text travels base64-encoded inside -EncodedCommand,
 * so no shell quoting is involved and non-ASCII file names survive.
 *
 * Node kills non-detached children when it exits, and a `detached`
 * powershell.exe has no console and exits without running the script - so the
 * caller must await waitForNotifications() before exiting.
 *
 * @param {string} message - The balloon body text.
 * @param {"Info"|"Error"} kind - Balloon icon.
 */
function showBalloon(message, kind = 'Info') {
  try {
    const text = String(message).replace(/[\r\n]+/g, ' ').slice(0, 250);
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    const icon = kind === 'Error' ? 'Error' : 'Information';
    // MAGICODE_NOTIFY_LOG (tests): run the same process and script, but append
    // the message to that file instead of showing a balloon.
    const testLog = process.env.MAGICODE_NOTIFY_LOG;
    const display = testLog
      ? [
        `Start-Sleep -Milliseconds 1500`,
        `[IO.File]::AppendAllText('${testLog.replace(/'/g, "''")}', "${kind} $text\`n", [Text.Encoding]::UTF8)`,
      ]
      : [
        '$n.Visible = $true',
        "$n.BalloonTipTitle = 'Magicode Uploader'",
        '$n.BalloonTipText = $text',
        `$n.BalloonTipIcon = '${kind === 'Error' ? 'Error' : 'Info'}'`,
        '$n.ShowBalloonTip(5000)',
        'Start-Sleep -Milliseconds 5100',
      ];
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
      `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`,
      '$n = New-Object System.Windows.Forms.NotifyIcon',
      `$n.Icon = [System.Drawing.SystemIcons]::${icon}`,
      ...display,
      '$n.Dispose()',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    );
    pending.push(new Promise((resolve) => {
      child.on('error', resolve);
      child.on('exit', resolve);
    }));
  } catch {
    // Notifications are best-effort; never crash the upload.
  }
}

/** Show a notification indicating that an upload is in progress. */
export function showUploading(filename) {
  showBalloon(`Uploading ${filename}...`);
}

/** Show a success notification after a completed upload. */
export function showSuccess(url, copied = true) {
  showBalloon(copied
    ? `Upload complete! Link copied to clipboard: ${url}`
    : `Upload complete (copying to the clipboard failed): ${url}`);
}

/** Show an error notification when an upload fails. */
export function showError(err) {
  showBalloon(`Upload failed: ${err instanceof Error ? err.message : err}`, 'Error');
}

/**
 * Resolve once every notification process has finished (about 6 seconds after
 * the last one was shown), or after `timeoutMs` at the latest.
 */
export function waitForNotifications(timeoutMs = 15000) {
  return Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
}
