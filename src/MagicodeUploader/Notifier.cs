using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace MagicodeUploader
{
    /// <summary>
    /// Tray balloons (shown as toasts on Windows 10/11). Must be used from the
    /// main (STA) thread. A balloon disappears with its tray icon, so
    /// <see cref="Linger"/> keeps the process alive, handling clicks, until the
    /// last one has closed.
    /// </summary>
    internal sealed class Notifier : IDisposable
    {
        private const int DisplayMs = 5000;
        // Upper bound on how long the process waits for the last balloon to close.
        private const int MaxLingerMs = 10000;

        // MAGICODE_NOTIFY_LOG (tests): append "<Kind> <text>" lines to this file instead of showing balloons.
        private readonly string _testLog = Environment.GetEnvironmentVariable("MAGICODE_NOTIFY_LOG");
        private NotifyIcon _icon;
        private string _openOnClick;
        private bool _closed;
        private readonly Stopwatch _sinceShown = new Stopwatch();

        public void ShowUploading(string label) => Show(Text.Uploading(label), ToolTipIcon.Info);

        public void ShowUploaded(string url, bool copied) =>
            Show(copied ? Text.Uploaded(url) : Text.UploadedNotCopied(url), ToolTipIcon.Info, url);

        public void ShowCopied(string url, bool copied) =>
            Show(copied ? Text.Copied(url) : Text.CopyFailed(url), ToolTipIcon.Info, url);

        public void ShowError(string message) => Show(Text.Failed(message), ToolTipIcon.Error);

        /// <param name="openOnClick">A link to open in the browser when the balloon is clicked.</param>
        private void Show(string message, ToolTipIcon kind, string openOnClick = null)
        {
            try
            {
                string text = Regex.Replace(message, @"[\r\n]+", " ");
                if (text.Length > 250) text = text.Substring(0, 250);

                if (!string.IsNullOrEmpty(_testLog))
                {
                    File.AppendAllText(_testLog, $"{(kind == ToolTipIcon.Error ? "Error" : "Info")} {text}\n", new UTF8Encoding(false));
                    return;
                }

                // Windows shows one balloon per icon at a time; a fresh icon replaces the previous message.
                _icon?.Dispose();
                var icon = new NotifyIcon
                {
                    Icon = kind == ToolTipIcon.Error ? SystemIcons.Error : SystemIcons.Information,
                    Text = Text.Title,
                    Visible = true,
                };
                icon.BalloonTipClicked += (s, e) => { if (s == _icon) OnClicked(); };
                icon.BalloonTipClosed += (s, e) => { if (s == _icon) _closed = true; };
                _icon = icon;
                _openOnClick = openOnClick;
                _closed = false;
                icon.ShowBalloonTip(DisplayMs, openOnClick != null ? Text.TitleClickToOpen : Text.Title, text, kind);
                _sinceShown.Restart();
            }
            catch
            {
                // Notifications are best-effort; never fail the upload over one.
            }
        }

        private void OnClicked()
        {
            _closed = true;
            if (_openOnClick == null) return;
            try
            {
                Process.Start(new ProcessStartInfo(_openOnClick) { UseShellExecute = true });
            }
            catch
            {
                // No default browser, etc.: the link is still on the clipboard.
            }
        }

        /// <summary>
        /// Keeps the last balloon alive (and clickable) until it closes: clicked,
        /// dismissed, or timed out into the notification centre.
        /// </summary>
        public void Linger()
        {
            if (_icon == null) return;
            // Click events arrive as window messages, so pump them while waiting.
            while (_sinceShown.ElapsedMilliseconds < MaxLingerMs &&
                   !(_closed && _sinceShown.ElapsedMilliseconds > 500))
            {
                Application.DoEvents();
                Thread.Sleep(50);
            }
        }

        public void Dispose()
        {
            _icon?.Dispose();
            _icon = null;
        }
    }
}
