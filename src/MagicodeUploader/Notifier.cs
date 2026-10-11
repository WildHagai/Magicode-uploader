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
    /// <see cref="Linger"/> keeps the process alive until the last one has shown.
    /// </summary>
    internal sealed class Notifier : IDisposable
    {
        private const string Title = "Magicode Uploader";
        private const int DisplayMs = 5000;

        // MAGICODE_NOTIFY_LOG (tests): append "<Kind> <text>" lines to this file instead of showing balloons.
        private readonly string _testLog = Environment.GetEnvironmentVariable("MAGICODE_NOTIFY_LOG");
        private NotifyIcon _icon;
        private readonly Stopwatch _sinceShown = new Stopwatch();

        public void ShowUploading(string label) => Show($"Uploading {label}...", ToolTipIcon.Info);

        public void ShowSuccess(string url, bool copied) => Show(copied
            ? $"Upload complete! Link copied to clipboard: {url}"
            : $"Upload complete (copying to the clipboard failed): {url}", ToolTipIcon.Info);

        public void ShowError(string message) => Show($"Upload failed: {message}", ToolTipIcon.Error);

        private void Show(string message, ToolTipIcon kind)
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
                _icon = new NotifyIcon
                {
                    Icon = kind == ToolTipIcon.Error ? SystemIcons.Error : SystemIcons.Information,
                    Text = Title,
                    Visible = true,
                };
                _icon.ShowBalloonTip(DisplayMs, Title, text, kind);
                _sinceShown.Restart();
            }
            catch
            {
                // Notifications are best-effort; never fail the upload over one.
            }
        }

        /// <summary>Waits until the last balloon has been on screen for its display time.</summary>
        public void Linger()
        {
            if (_icon == null) return;
            int remaining = DisplayMs + 100 - (int)_sinceShown.ElapsedMilliseconds;
            if (remaining > 0) Thread.Sleep(remaining);
        }

        public void Dispose()
        {
            _icon?.Dispose();
            _icon = null;
        }
    }
}
