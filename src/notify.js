import { exec } from 'node:child_process';

/**
 * Escape a string for safe embedding inside a PowerShell single-quoted
 * string literal.  Single quotes are the only characters that need
 * escaping inside PS single-quoted strings (doubled: ' -> '').
 * We also strip control characters that could break the command.
 */
function psEscape(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  // Remove carriage-return / newline so the balloon text stays on one line,
  // then escape single quotes for PowerShell single-quoted strings.
  return str
    .replace(/[\r\n]+/g, ' ')
    .replace(/'/g, "''");
}

/**
 * Fire-and-forget a PowerShell balloon (toast) notification.
 * Failures are silently swallowed so they never crash the main app.
 *
 * @param {string} message  - The balloon body text.
 * @param {"Info"|"Error"} icon - BalloonTipIcon value.
 */
function showBalloon(message, icon = 'Info') {
  try {
    const systemIcon = icon === 'Error' ? 'Error' : 'Information';
    const escapedMessage = psEscape(message);

    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$n = New-Object System.Windows.Forms.NotifyIcon;',
      `$n.Icon = [System.Drawing.SystemIcons]::${systemIcon};`,
      '$n.Visible = $true;',
      `$n.BalloonTipTitle = 'Magicode Uploader';`,
      `$n.BalloonTipText = '${escapedMessage}';`,
      `$n.BalloonTipIcon = '${icon}';`,
      '$n.ShowBalloonTip(5000);',
      'Start-Sleep -Milliseconds 5100;',
      '$n.Dispose()',
    ].join(' ');

    exec(
      `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
      () => {},
    );
  } catch {
    // PowerShell may not be available – silently ignore.
  }
}

/**
 * Show a notification indicating that an upload is in progress.
 *
 * Accepts a single filename string.
 * @param {string} filename - Name of the file being uploaded.
 */
export function showUploading(filename) {
  try {
    const name = typeof filename === 'string' ? filename : String(filename);
    showBalloon(`Uploading ${name}...`);
  } catch {
    // Never crash the main app.
  }
}

/**
 * Show a success notification after a completed upload.
 *
 * Can be called as:
 *   showSuccess(url)              – legacy / current main.js usage
 *   showSuccess(filename, url)    – new two-argument form
 *
 * @param {string} filenameOrUrl - Filename (when two args) or download URL (when one arg).
 * @param {string} [url]         - The download URL (optional second argument).
 */
export function showSuccess(filenameOrUrl, url) {
  try {
    if (url !== undefined) {
      // Two-argument form: showSuccess(filename, url)
      showBalloon(`Upload complete! URL copied to clipboard\n${url}`);
    } else {
      // One-argument form: showSuccess(url)  – backwards compatible
      showBalloon(`Upload complete! URL copied to clipboard\n${filenameOrUrl}`);
    }
  } catch {
    // Never crash the main app.
  }
}

/**
 * Show an error notification when an upload fails.
 *
 * Can be called as:
 *   showError(error)                 – legacy: Error object
 *   showError(filename, errorMsg)    – new two-argument form
 *
 * @param {string|Error} filenameOrError - Filename (when two args) or Error object (when one arg).
 * @param {string}       [errorMessage]  - The error description (optional second argument).
 */
export function showError(filenameOrError, errorMessage) {
  try {
    let text;

    if (errorMessage !== undefined) {
      // Two-argument form: showError(filename, errorMessage)
      text = `Upload failed for ${filenameOrError}: ${errorMessage}`;
    } else if (filenameOrError instanceof Error) {
      // Legacy one-argument form with an Error object.
      text = `Upload failed: ${filenameOrError.message}`;
    } else {
      // Fallback: treat the single argument as a plain string message.
      text = `Upload failed: ${filenameOrError}`;
    }

    showBalloon(text, 'Error');
  } catch {
    // Never crash the main app.
  }
}
