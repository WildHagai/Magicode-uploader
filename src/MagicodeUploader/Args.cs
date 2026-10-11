using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace MagicodeUploader
{
    internal static class Args
    {
        /// <summary>
        /// Paths come either directly on the command line, or (from the Explorer
        /// context menu) as <c>--list &lt;file&gt;</c>: a UTF-8 file with one path per
        /// line, which avoids the command-line length limit on large selections.
        /// The list file is deleted after reading.
        /// </summary>
        public static List<string> Read(string[] argv)
        {
            if (argv.Length >= 2 && argv[0] == "--list")
            {
                string listFile = argv[1];
                // ReadAllText drops a UTF-8 BOM if there is one.
                string text = File.ReadAllText(listFile, Encoding.UTF8);
                try { File.Delete(listFile); } catch { }
                return text.Split(new[] { "\r\n", "\n" }, System.StringSplitOptions.RemoveEmptyEntries).ToList();
            }
            return argv.ToList();
        }

        /// <summary>Name for the archive when more than one item, or a folder, is uploaded.</summary>
        public static string ZipNameFor(IReadOnlyList<string> paths)
        {
            string baseName = paths.Count == 1
                ? NameOf(paths[0])
                : NameOf(Path.GetDirectoryName(paths[0].TrimEnd('\\', '/')) ?? paths[0]);
            return baseName + ".zip";
        }

        // "C:\Photos" -> "Photos"; a drive root "D:\" -> "D".
        internal static string NameOf(string path)
        {
            string name = Path.GetFileName(path.TrimEnd('\\', '/'));
            if (string.IsNullOrEmpty(name)) name = Regex.Replace(path, @"[:\\/]", "");
            return string.IsNullOrEmpty(name) ? "files" : name;
        }
    }
}
