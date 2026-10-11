using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.CSharp;
using Xunit;

namespace MagicodeUploader.Tests
{
    /// <summary>
    /// Loads MagicodeNative.dll (built by scripts\build-dll.bat or CI) and calls its
    /// IExplorerCommand objects the way Explorer does. Next to the DLL copy sits a
    /// stand-in MagicodeUploader.exe that records the command line it was started with.
    /// Skipped when the DLL hasn't been built (it needs the Windows SDK).
    /// </summary>
    public sealed class NativeDllTests : IDisposable
    {
        private static readonly Guid UploadClsid = new Guid("7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071");
        private static readonly Guid RecentClsid = new Guid("7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6072");
        private const int EcsEnabled = 0, EcsDisabled = 1, EcsHidden = 2, EcfHasSubcommands = 1;

        private static readonly string BuiltDll = FindBuiltDll();
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "magicode-dll-tests-" + Guid.NewGuid().ToString("N"));
        private readonly string _argsFile;
        private readonly IntPtr _module;
        private readonly string _savedLang = Environment.GetEnvironmentVariable("MAGICODE_LANG");

        public NativeDllTests()
        {
            if (BuiltDll == null) return;  // each test skips itself
            Directory.CreateDirectory(_dir);
            File.Copy(BuiltDll, Path.Combine(_dir, "MagicodeNative.dll"));
            _argsFile = Path.Combine(_dir, "args.txt");
            CompileRecorderExe(Path.Combine(_dir, "MagicodeUploader.exe"));
            Environment.SetEnvironmentVariable("MAGICODE_LANG", "en");
            _module = LoadLibrary(Path.Combine(_dir, "MagicodeNative.dll"));
            Assert.NotEqual(IntPtr.Zero, _module);
        }

        public void Dispose()
        {
            Environment.SetEnvironmentVariable("MAGICODE_LANG", _savedLang);
            GC.Collect();
            GC.WaitForPendingFinalizers();
            if (_module != IntPtr.Zero) FreeLibrary(_module);
            try { Directory.Delete(_dir, true); } catch { }
        }

        [SkippableFact]
        public void Upload_command_title_follows_the_display_language()
        {
            RequireDll();
            var cmd = Create(UploadClsid);
            Assert.Equal("Upload to Magicode", Title(cmd));
            Environment.SetEnvironmentVariable("MAGICODE_LANG", "he");
            Assert.Equal("העלאה ל-Magicode", Title(cmd));
        }

        [SkippableFact]
        public void Upload_command_is_hidden_without_files_on_disk()
        {
            RequireDll();
            var cmd = Create(UploadClsid);
            Assert.Equal(0, cmd.GetState(IntPtr.Zero, 1, out int state));
            Assert.Equal(EcsHidden, state);
        }

        [SkippableFact]
        public void Upload_command_passes_the_whole_selection_in_a_list_file()
        {
            RequireDll();
            string a = Path.Combine(_dir, "קובץ א.txt"), b = Path.Combine(_dir, "second file.pdf");
            File.WriteAllText(a, "a");
            File.WriteAllText(b, "b");
            IntPtr items = ShellItemArray(a, b);
            try
            {
                var cmd = Create(UploadClsid);
                Assert.Equal(0, cmd.GetState(items, 1, out int state));
                Assert.Equal(EcsEnabled, state);
                Assert.Equal(0, cmd.Invoke(items, IntPtr.Zero));
            }
            finally
            {
                Marshal.Release(items);
            }

            string args = WaitForLaunch();
            var m = System.Text.RegularExpressions.Regex.Match(args, "--list \"([^\"]+)\"");
            Assert.True(m.Success, args);
            var listed = File.ReadAllText(m.Groups[1].Value, Encoding.UTF8).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
            File.Delete(m.Groups[1].Value);
            Assert.Equal(new[] { a, b }, listed);
        }

        [SkippableFact]
        public void Recent_links_list_the_history_newest_first_and_copy_on_click()
        {
            RequireDll();
            string today = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
            File.WriteAllLines(Path.Combine(_dir, "recent.txt"), new[]
            {
                $"{today}\tdocument.pdf\thttps://send.magicode.me/send-file/file/aaa/view",
                "2026-01-02T10:00:00Z\tתמונות.zip\thttps://send.magicode.me/send-file/file/bbb/view",
                "2026-01-01T10:00:00Z\tbad.txt\thttps://example.test/\" --evil",   // quote: skipped
                "2026-01-01T10:00:00Z\tbad2.txt\tjavascript:alert(1)",             // not a link: skipped
                "not a history line",
            }, new UTF8Encoding(false));

            var cmd = Create(RecentClsid);
            Assert.Equal("Magicode: recent links", Title(cmd));
            Assert.Equal(0, cmd.GetFlags(out int flags));
            Assert.Equal(EcfHasSubcommands, flags);

            var subs = SubCommands(cmd);
            Assert.Equal(2, subs.Count);
            string first = Title(subs[0]);
            Assert.StartsWith("document.pdf (", first);
            Assert.DoesNotContain("2026", first);  // today: time only
            Assert.StartsWith("תמונות.zip (", Title(subs[1]));

            Assert.Equal(0, subs[1].Invoke(IntPtr.Zero, IntPtr.Zero));
            Assert.EndsWith("--copy \"https://send.magicode.me/send-file/file/bbb/view\"", WaitForLaunch());
        }

        [SkippableFact]
        public void Recent_links_without_history_show_a_disabled_placeholder()
        {
            RequireDll();
            var subs = SubCommands(Create(RecentClsid));
            Assert.Single(subs);
            Assert.Equal("No uploads yet", Title(subs[0]));
            Assert.Equal(0, subs[0].GetState(IntPtr.Zero, 1, out int state));
            Assert.Equal(EcsDisabled, state);
            Assert.Equal(0, subs[0].Invoke(IntPtr.Zero, IntPtr.Zero));
            Thread.Sleep(500);
            Assert.False(File.Exists(_argsFile), "the placeholder must not start the uploader");
        }

        // --- helpers ---

        private static void RequireDll() =>
            Skip.If(BuiltDll == null, "MagicodeNative.dll has not been built (npm run build:dll)");

        private static string FindBuiltDll()
        {
            for (var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory); dir != null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "AppxManifest.xml")))
                {
                    string dll = Path.Combine(dir.FullName, "src", "win11", "build", "MagicodeNative.dll");
                    return File.Exists(dll) ? dll : null;
                }
            }
            return null;
        }

        // A tiny exe that writes its command line to args.txt next to itself.
        private static void CompileRecorderExe(string path)
        {
            using (var csc = new CSharpCodeProvider())
            {
                var options = new CompilerParameters { GenerateExecutable = true, OutputAssembly = path };
                var result = csc.CompileAssemblyFromSource(options,
                    "class P { static void Main() { var d = System.AppDomain.CurrentDomain.BaseDirectory; " +
                    "System.IO.File.WriteAllText(System.IO.Path.Combine(d, \"args.txt\"), System.Environment.CommandLine, System.Text.Encoding.UTF8); } }");
                Assert.False(result.Errors.HasErrors, string.Join("\n", result.Errors.Cast<CompilerError>()));
            }
        }

        private string WaitForLaunch()
        {
            for (int i = 0; i < 100 && !File.Exists(_argsFile); i++) Thread.Sleep(100);
            Assert.True(File.Exists(_argsFile), "the uploader was not started");
            for (int i = 0; i < 20; i++)
            {
                try { return File.ReadAllText(_argsFile, Encoding.UTF8); }
                catch (IOException) { Thread.Sleep(100); }
            }
            return File.ReadAllText(_argsFile, Encoding.UTF8);
        }

        private IExplorerCommand Create(Guid clsid)
        {
            var getClassObject = Marshal.GetDelegateForFunctionPointer<DllGetClassObjectFn>(GetProcAddress(_module, "DllGetClassObject"));
            Guid iidFactory = typeof(IClassFactory).GUID, iidCommand = typeof(IExplorerCommand).GUID;
            Assert.Equal(0, getClassObject(ref clsid, ref iidFactory, out object factory));
            Assert.Equal(0, ((IClassFactory)factory).CreateInstance(IntPtr.Zero, ref iidCommand, out object command));
            return (IExplorerCommand)command;
        }

        private static string Title(IExplorerCommand cmd)
        {
            Assert.Equal(0, cmd.GetTitle(IntPtr.Zero, out IntPtr p));
            try { return Marshal.PtrToStringUni(p); } finally { Marshal.FreeCoTaskMem(p); }
        }

        private static List<IExplorerCommand> SubCommands(IExplorerCommand cmd)
        {
            Assert.Equal(0, cmd.EnumSubCommands(out IEnumExplorerCommand e));
            var list = new List<IExplorerCommand>();
            var one = new IExplorerCommand[1];
            while (e.Next(1, one, out uint fetched) == 0 && fetched == 1) list.Add(one[0]);
            return list;
        }

        private static IntPtr ShellItemArray(params string[] paths)
        {
            var pidls = paths.Select(p =>
            {
                Assert.Equal(0, SHParseDisplayName(p, IntPtr.Zero, out IntPtr pidl, 0, out _));
                return pidl;
            }).ToArray();
            try
            {
                Assert.Equal(0, SHCreateShellItemArrayFromIDLists((uint)pidls.Length, pidls, out IntPtr array));
                return array;
            }
            finally
            {
                foreach (var pidl in pidls) Marshal.FreeCoTaskMem(pidl);
            }
        }

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int DllGetClassObjectFn(ref Guid clsid, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string path);

        [DllImport("kernel32.dll")]
        private static extern bool FreeLibrary(IntPtr module);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHParseDisplayName(string name, IntPtr bindCtx, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);

        [DllImport("shell32.dll")]
        private static extern int SHCreateShellItemArrayFromIDLists(uint count, IntPtr[] pidls, out IntPtr array);
    }

    [ComImport, Guid("00000001-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IClassFactory
    {
        [PreserveSig] int CreateInstance(IntPtr outer, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
        [PreserveSig] int LockServer(bool fLock);
    }

    [ComImport, Guid("a08ce4d0-fa25-44ab-b57c-c7b1c323e0b9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IExplorerCommand
    {
        [PreserveSig] int GetTitle(IntPtr items, out IntPtr name);
        [PreserveSig] int GetIcon(IntPtr items, out IntPtr icon);
        [PreserveSig] int GetToolTip(IntPtr items, out IntPtr tip);
        [PreserveSig] int GetCanonicalName(out Guid name);
        [PreserveSig] int GetState(IntPtr items, int okToBeSlow, out int state);
        [PreserveSig] int Invoke(IntPtr items, IntPtr bindCtx);
        [PreserveSig] int GetFlags(out int flags);
        [PreserveSig] int EnumSubCommands(out IEnumExplorerCommand commands);
    }

    [ComImport, Guid("a88826f8-186f-4987-aade-ea0cef8fbfe8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumExplorerCommand
    {
        [PreserveSig] int Next(uint count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] IExplorerCommand[] commands, out uint fetched);
        [PreserveSig] int Skip(uint count);
        [PreserveSig] int Reset();
        [PreserveSig] int Clone(out IEnumExplorerCommand clone);
    }
}
