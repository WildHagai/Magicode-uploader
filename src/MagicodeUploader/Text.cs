using System;
using System.Globalization;

namespace MagicodeUploader
{
    /// <summary>
    /// Everything the user reads, in English or Hebrew to match the Windows display
    /// language. MAGICODE_LANG=en|he overrides it (tests).
    /// </summary>
    internal static class Text
    {
        public static readonly bool Hebrew =
            (Environment.GetEnvironmentVariable("MAGICODE_LANG") ?? CultureInfo.CurrentUICulture.TwoLetterISOLanguageName) == "he";

        private static string T(string en, string he) => Hebrew ? he : en;

        public static string Title => "Magicode Uploader";
        public static string TitleClickToOpen => T("Magicode Uploader - click to open the link", "Magicode Uploader - לחצו לפתיחת הקישור");

        public static string Usage => "Usage: MagicodeUploader <file-or-folder> [more...]";

        public static string Compressing(string zipName, int count) => count == 1
            ? T($"{zipName} (compressing 1 item)", $"{zipName} (דוחס פריט אחד)")
            : T($"{zipName} (compressing {count} items)", $"{zipName} (דוחס {count} פריטים)");

        public static string Uploading(string label) => T($"Uploading {label}...", $"מעלה את {label}...");
        public static string Uploaded(string url) => T($"Upload complete! Link copied to clipboard: {url}", $"ההעלאה הסתיימה! הקישור הועתק ללוח: {url}");
        public static string UploadedNotCopied(string url) => T($"Upload complete (copying to the clipboard failed): {url}", $"ההעלאה הסתיימה (ההעתקה ללוח נכשלה): {url}");
        public static string Copied(string url) => T($"Link copied to clipboard: {url}", $"הקישור הועתק ללוח: {url}");
        public static string CopyFailed(string url) => T($"Copying to the clipboard failed: {url}", $"ההעתקה ללוח נכשלה: {url}");
        public static string Failed(string message) => T($"Upload failed: {message}", $"ההעלאה נכשלה: {message}");

        // Errors
        public static string NotFound(string path) => T($"File not found: {path}", $"הקובץ לא נמצא: {path}");
        public static string NotAFile(string path) => T($"Path is not a file: {path}", $"הנתיב אינו קובץ: {path}");
        public static string Empty(string name) => T($"{name} is empty (send.magicode.me rejects empty files)", $"{name} ריק (send.magicode.me לא מקבל קבצים ריקים)");
        public static string TooLarge(string name, long size) =>
            T($"{name} is {Size(size)}; send.magicode.me accepts files up to {Size(Uploader.MaxFileSize)}",
              $"{name} בגודל {Size(size)}; send.magicode.me מקבל קבצים עד {Size(Uploader.MaxFileSize)}");
        public static string CannotRead(string path, string reason) => T($"Couldn't read {path}: {reason}", $"לא ניתן לקרוא את {path}: {reason}");
        public static string FileChanged(string name) => T($"{name} changed while it was uploading", $"{name} השתנה בזמן ההעלאה");
        public static string NoConnection => T("Couldn't reach send.magicode.me. Check your internet connection.", "אין חיבור ל-send.magicode.me. בדקו את החיבור לאינטרנט.");
        public static string TimedOut => T("send.magicode.me didn't respond in time. Please try again later.", "send.magicode.me לא הגיב בזמן. נסו שוב מאוחר יותר.");
        public static string ServerTrouble(int? status) => status.HasValue
            ? T($"send.magicode.me is having trouble right now (HTTP {status}). Please try again later.", $"יש כרגע תקלה ב-send.magicode.me (HTTP {status}). נסו שוב מאוחר יותר.")
            : T("send.magicode.me is having trouble right now. Please try again later.", "יש כרגע תקלה ב-send.magicode.me. נסו שוב מאוחר יותר.");
        public static string Refused(int status) => T($"send.magicode.me refused the upload (HTTP {status}).", $"send.magicode.me דחה את ההעלאה (HTTP {status}).");
        public static string Unexpected => T("send.magicode.me sent an unexpected answer. Please try again later.", "send.magicode.me החזיר תשובה לא צפויה. נסו שוב מאוחר יותר.");

        /// <summary>"12.3 GB", "850 MB", "4 KB" (binary units, as Explorer shows them).</summary>
        public static string Size(long bytes)
        {
            string[] units = { "bytes", "KB", "MB", "GB", "TB" };
            double value = bytes;
            int unit = 0;
            while (value >= 1024 && unit < units.Length - 1) { value /= 1024; unit++; }
            string number = unit == 0 || value >= 100 || value % 1 == 0
                ? value.ToString("0", CultureInfo.InvariantCulture)
                : value.ToString("0.#", CultureInfo.InvariantCulture);
            return $"{number} {units[unit]}";
        }
    }
}
