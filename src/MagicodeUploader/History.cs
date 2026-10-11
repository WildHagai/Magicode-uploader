using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace MagicodeUploader
{
    /// <summary>
    /// The last uploads, newest first, in recent.txt next to the exe: one
    /// "&lt;UTC time&gt;\t&lt;file name&gt;\t&lt;link&gt;" line each. The context menu's
    /// "recent links" submenu (MagicodeNative.dll) reads the same file.
    /// </summary>
    internal static class History
    {
        public const int MaxEntries = 10;

        public static readonly string FilePath = Environment.GetEnvironmentVariable("MAGICODE_HISTORY_PATH") is string p && p.Length > 0
            ? p
            : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recent.txt");

        public static void Add(string name, string url)
        {
            // Tabs and line breaks would break the line format; file names can't contain them anyway.
            name = name.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
            string line = $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}\t{name}\t{url}";

            // Two uploads finishing at once must not lose each other's entry.
            using (var mutex = new Mutex(false, @"Local\MagicodeUploaderHistory"))
            {
                bool locked = false;
                try
                {
                    try { locked = mutex.WaitOne(5000); } catch (AbandonedMutexException) { locked = true; }
                    var lines = new List<string> { line };
                    if (File.Exists(FilePath))
                        lines.AddRange(File.ReadAllLines(FilePath, Encoding.UTF8).Where(l => l.Split('\t').Length == 3));

                    string temp = FilePath + ".tmp";
                    File.WriteAllLines(temp, lines.Take(MaxEntries), new UTF8Encoding(false));
                    if (File.Exists(FilePath)) File.Replace(temp, FilePath, null);
                    else File.Move(temp, FilePath);
                }
                finally
                {
                    if (locked) mutex.ReleaseMutex();
                }
            }
        }
    }
}
