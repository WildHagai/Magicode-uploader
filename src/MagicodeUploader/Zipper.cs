using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;

namespace MagicodeUploader
{
    internal static class Zipper
    {
        /// <summary>
        /// Compresses files and/or folders into one ZIP archive. Folders are added
        /// recursively under their own name. The archive is created in a fresh
        /// temporary folder (magicode-XXXXXX) so its name never collides; the
        /// caller deletes that folder.
        /// </summary>
        public static string CreateZip(IReadOnlyList<string> paths, string zipName)
        {
            if (paths == null || paths.Count == 0) throw new ArgumentException("paths must be a non-empty list");
            foreach (string p in paths)
            {
                if (!File.Exists(p) && !Directory.Exists(p)) throw new FileNotFoundException($"File not found or not readable: {p}");
            }

            string dir = Path.Combine(Path.GetTempPath(), "magicode-" + Path.GetRandomFileName().Replace(".", "").Substring(0, 6));
            Directory.CreateDirectory(dir);
            string zipPath = Path.Combine(dir, zipName);

            try
            {
                // Non-ASCII entry names are stored as UTF-8 (with the ZIP language encoding flag).
                using (var archive = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (string p in paths)
                    {
                        string name = Unique(Args.NameOf(p), used);
                        if (Directory.Exists(p)) AddDirectory(archive, p, name);
                        else AddFile(archive, p, name);
                    }
                }
            }
            catch
            {
                try { Directory.Delete(dir, true); } catch { }
                throw;
            }
            return zipPath;
        }

        private static void AddDirectory(ZipArchive archive, string dir, string entryName)
        {
            archive.CreateEntry(entryName + "/");
            foreach (string sub in Directory.EnumerateDirectories(dir))
            {
                // Don't follow junctions/symlinks: they can loop back up the tree.
                if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                AddDirectory(archive, sub, entryName + "/" + Path.GetFileName(sub));
            }
            foreach (string file in Directory.EnumerateFiles(dir))
            {
                AddFile(archive, file, entryName + "/" + Path.GetFileName(file));
            }
        }

        private static void AddFile(ZipArchive archive, string file, string entryName)
        {
            try
            {
                // Share read/write so files that are open in another program (e.g. a log) can still be read.
                using (var source = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
                    entry.LastWriteTime = File.GetLastWriteTime(file);
                    using (var target = entry.Open()) source.CopyTo(target);
                }
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                throw new IOException($"Could not read {file}: {e.Message}", e);
            }
        }

        // Two top-level items with the same name (possible from the command line) get "name (2)".
        private static string Unique(string name, HashSet<string> used)
        {
            string candidate = name;
            string stem = Path.GetFileNameWithoutExtension(name), ext = Path.GetExtension(name);
            for (int i = 2; !used.Add(candidate); i++) candidate = $"{stem} ({i}){ext}";
            return candidate;
        }
    }
}
