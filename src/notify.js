import { spawn } from 'node:child_process';

// One hidden PowerShell process owns a single tray icon for the whole upload.
// Messages arrive on stdin as "<Info|Error> <base64 utf-8 text>" lines (base64
// so non-ASCII file names survive the console code page). When stdin closes,
// the last balloon stays up for a few seconds and the icon is removed.
const NOTIFIER_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Text = 'Magicode Uploader'
$n.Visible = $true
try {
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    $kind, $b64 = $line -split ' ', 2
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    if ($kind -eq 'Error') { $n.Icon = [System.Drawing.SystemIcons]::Error }
    $n.BalloonTipTitle = 'Magicode Uploader'
    $n.BalloonTipText = $text
    $n.BalloonTipIcon = $kind
    $n.ShowBalloonTip(5000)
  }
  Start-Sleep -Seconds 6
} finally {
  $n.Dispose()
}
`;

let notifier = null;

function getNotifier() {
  if (notifier) return notifier;
  try {
    const encoded = Buffer.from(NOTIFIER_SCRIPT, 'utf16le').toString('base64');
    notifier = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, detached: true },
    );
    notifier.on('error', () => {});
    notifier.stdin.on('error', () => {});
    notifier.unref();
  } catch {
    notifier = null;
  }
  return notifier;
}

function showBalloon(text, kind = 'Info') {
  try {
    const p = getNotifier();
    if (!p) return;
    const oneLine = String(text).replace(/[\r\n]+/g, ' ').slice(0, 250);
    p.stdin.write(`${kind} ${Buffer.from(oneLine, 'utf-8').toString('base64')}\n`);
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
 * Close the notifier's input so it can show the final balloon and exit on its
 * own. Resolves once the message has been flushed to the notifier process.
 */
export function finishNotifications() {
  return new Promise((resolve) => {
    if (!notifier?.stdin?.writable) return resolve();
    notifier.stdin.end(resolve);
  });
}
