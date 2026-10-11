using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MagicodeUploader
{
    internal static class Program
    {
        // Test hooks: point at a mock server, speed up retries, log elsewhere.
        private static readonly Uri BaseUrl = new Uri(Env("MAGICODE_BASE_URL") ?? "https://send.magicode.me");
        private static readonly int RetryDelayMs = EnvInt("MAGICODE_RETRY_DELAY_MS", 1000);
        private static readonly int UploadingDelayMs = EnvInt("MAGICODE_UPLOADING_DELAY_MS", 1500);
        private static readonly string LogPath = Env("MAGICODE_LOG_PATH")
            ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "upload.log");

        [STAThread] // the clipboard and tray icons need an STA thread
        private static int Main(string[] argv)
        {
            UseUtf8WhenRedirected();
            using (var notifier = new Notifier())
            {
                int exitCode;
                try
                {
                    exitCode = argv.Length == 2 && argv[0] == "--copy"
                        ? CopyAgain(argv[1], notifier)
                        : Upload(argv, notifier);
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine($"Error: {e.Message}");
                    Log($"error: {e}" + (e is UploadException u && u.Detail != null ? $"\n  detail: {u.Detail}" : ""));
                    notifier.ShowError(e.Message);
                    exitCode = 1;
                }
                notifier.Linger();
                return exitCode;
            }
        }

        private static int Upload(string[] argv, Notifier notifier)
        {
            List<string> paths = Args.Read(argv).Select(Path.GetFullPath).ToList();
            if (paths.Count == 0)
            {
                Console.Error.WriteLine(Text.Usage);
                return 1;
            }
            foreach (string p in paths)
            {
                if (!File.Exists(p) && !Directory.Exists(p)) throw new UploadException(Text.NotFound(p));
            }

            bool needsZip = paths.Count > 1 || Directory.Exists(paths[0]);
            string zipName = Args.ZipNameFor(paths);
            string label = needsZip ? Text.Compressing(zipName, paths.Count) : Path.GetFileName(paths[0]);

            string tempZip = null;
            // Don't let the PC go to sleep in the middle of a long upload.
            SetThreadExecutionState(EsContinuous | EsSystemRequired);
            try
            {
                Task<string> work = Task.Run(async () =>
                {
                    string file = paths[0];
                    if (needsZip) file = tempZip = Zipper.CreateZip(paths, zipName);
                    using (var uploader = new Uploader(BaseUrl, RetryDelayMs))
                    {
                        return await uploader.UploadAsync(file).ConfigureAwait(false);
                    }
                });

                // Windows shows tray balloons one at a time, so an "Uploading..." balloon
                // would hold back the result. Only show it for slow uploads.
                if (Task.WaitAny(new Task[] { work }, UploadingDelayMs) < 0) notifier.ShowUploading(label);
                string link = work.GetAwaiter().GetResult();

                bool copied = CopyToClipboard(link);
                Console.WriteLine(link);
                Log($"uploaded {tempZip ?? paths[0]} -> {link}");
                try { History.Add(needsZip ? zipName : Path.GetFileName(paths[0]), link); }
                catch (Exception e) { Log($"history failed: {e.Message}"); }
                notifier.ShowUploaded(link, copied);
                return 0;
            }
            finally
            {
                SetThreadExecutionState(EsContinuous);
                if (tempZip != null)
                {
                    try { Directory.Delete(Path.GetDirectoryName(tempZip), true); } catch { }
                }
            }
        }

        /// <summary>"--copy &lt;link&gt;": from the recent-links menu; copies an earlier link again.</summary>
        private static int CopyAgain(string link, Notifier notifier)
        {
            if (!Uri.TryCreate(link, UriKind.Absolute, out Uri uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            {
                Console.Error.WriteLine(Text.Usage);
                return 1;
            }
            bool copied = CopyToClipboard(uri.AbsoluteUri);
            Console.WriteLine(uri.AbsoluteUri);
            notifier.ShowCopied(uri.AbsoluteUri, copied);
            return copied ? 0 : 1;
        }

        private static bool CopyToClipboard(string text)
        {
            try
            {
                // Retries while another program (e.g. clipboard history) has the clipboard open.
                Clipboard.SetDataObject(text, true, 10, 100);
                return true;
            }
            catch (Exception e)
            {
                Log($"clipboard failed: {e.Message}");
                return false;
            }
        }

        private static void Log(string message)
        {
            try
            {
                File.AppendAllText(LogPath, $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ} {message}\n", new UTF8Encoding(false));
            }
            catch { }
        }

        // Console output is in the OEM code page by default; callers that capture it
        // (scripts, tests) get UTF-8 instead. An interactive console is left alone.
        private static void UseUtf8WhenRedirected()
        {
            var utf8 = new UTF8Encoding(false);
            if (Console.IsOutputRedirected)
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
            if (Console.IsErrorRedirected)
                Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
        }

        private static string Env(string name)
        {
            string v = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrEmpty(v) ? null : v;
        }

        private static int EnvInt(string name, int fallback) =>
            int.TryParse(Env(name), out int v) && v >= 0 ? v : fallback;

        private const uint EsContinuous = 0x80000000;
        private const uint EsSystemRequired = 0x00000001;

        [DllImport("kernel32.dll")]
        private static extern uint SetThreadExecutionState(uint flags);
    }
}
