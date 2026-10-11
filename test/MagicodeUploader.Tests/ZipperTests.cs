using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Xunit;

namespace MagicodeUploader.Tests
{
    public sealed class ZipperTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "magicode-zip-tests-" + Guid.NewGuid().ToString("N"));
        private readonly List<string> _zips = new List<string>();

        public ZipperTests()
        {
            Directory.CreateDirectory(Path.Combine(_dir, "תיקייה", "sub"));
            Directory.CreateDirectory(Path.Combine(_dir, "תיקייה", "empty"));
            File.WriteAllText(Path.Combine(_dir, "a.txt"), "alpha");
            File.WriteAllText(Path.Combine(_dir, "קובץ.txt"), "שלום", Encoding.UTF8);
            File.WriteAllText(Path.Combine(_dir, "תיקייה", "in.txt"), "inside");
            File.WriteAllText(Path.Combine(_dir, "תיקייה", "sub", "deep.txt"), "deep");
        }

        public void Dispose()
        {
            foreach (string z in _zips) Directory.Delete(Path.GetDirectoryName(z), true);
            Directory.Delete(_dir, true);
        }

        private Dictionary<string, string> Zip(string name, params string[] relPaths)
        {
            string zip = Zipper.CreateZip(relPaths.Select(p => Path.Combine(_dir, p)).ToList(), name);
            _zips.Add(zip);
            Assert.Equal(name, Path.GetFileName(zip));
            using (var archive = ZipFile.OpenRead(zip))
            {
                return archive.Entries.ToDictionary(e => e.FullName, e =>
                {
                    using (var r = new StreamReader(e.Open(), Encoding.UTF8)) return r.ReadToEnd();
                });
            }
        }

        [Fact]
        public void Files_go_in_under_their_own_names()
        {
            var entries = Zip("bundle.zip", "a.txt", "קובץ.txt");
            Assert.Equal(new[] { "a.txt", "קובץ.txt" }, entries.Keys.OrderBy(k => k, StringComparer.Ordinal));
            Assert.Equal("alpha", entries["a.txt"]);
            Assert.Equal("שלום", entries["קובץ.txt"].TrimStart('﻿'));
        }

        [Fact]
        public void Folders_are_added_recursively_under_the_folder_name_including_empty_ones()
        {
            var entries = Zip("תיקייה.zip", "תיקייה");
            Assert.Equal("inside", entries["תיקייה/in.txt"]);
            Assert.Equal("deep", entries["תיקייה/sub/deep.txt"]);
            Assert.Contains("תיקייה/empty/", entries.Keys);
        }

        [Fact]
        public void Files_and_folders_mix_in_one_archive()
        {
            var files = Zip("mixed.zip", "a.txt", "תיקייה").Keys.Where(k => !k.EndsWith("/")).OrderBy(k => k, StringComparer.Ordinal);
            Assert.Equal(new[] { "a.txt", "תיקייה/in.txt", "תיקייה/sub/deep.txt" }, files);
        }

        [Fact]
        public void A_file_open_in_another_program_can_still_be_zipped()
        {
            using (var open = new FileStream(Path.Combine(_dir, "a.txt"), FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
            {
                Assert.Equal("alpha", Zip("busy.zip", "a.txt")["a.txt"]);
            }
        }

        [Fact]
        public void Each_archive_gets_its_own_temp_folder()
        {
            Zip("same.zip", "a.txt");
            Zip("same.zip", "a.txt");
            Assert.NotEqual(Path.GetDirectoryName(_zips[0]), Path.GetDirectoryName(_zips[1]));
            Assert.Matches(@"^magicode-[A-Za-z0-9]{6}$", Path.GetFileName(Path.GetDirectoryName(_zips[0])));
        }

        [Fact]
        public void Duplicate_top_level_names_are_made_unique()
        {
            Directory.CreateDirectory(Path.Combine(_dir, "other"));
            File.WriteAllText(Path.Combine(_dir, "other", "a.txt"), "second");
            var entries = Zip("dupes.zip", "a.txt", Path.Combine("other", "a.txt"));
            Assert.Equal("alpha", entries["a.txt"]);
            Assert.Equal("second", entries["a (2).txt"]);
        }

        [Fact]
        public void Missing_paths_and_empty_input_are_rejected()
        {
            Assert.Throws<FileNotFoundException>(() => Zipper.CreateZip(new[] { Path.Combine(_dir, "nope.txt") }, "x.zip"));
            Assert.Throws<ArgumentException>(() => Zipper.CreateZip(new string[0], "x.zip"));
        }
    }
}
