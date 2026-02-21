# Magicode Uploader

Upload files to [send.magicode.me](https://send.magicode.me) directly from the Windows Explorer context menu.

**[עברית למטה](#magicode-uploader---עברית)**

---

## Features

- **Windows Explorer integration** — Right-click any file or folder and select "Upload to Magicode"
- **Windows 11 modern context menu** — Appears in the top-level menu (not buried under "Show more options")
- **Classic context menu** — Also works in the classic menu for full compatibility
- **Multiple file support** — Select multiple files and they'll be zipped into a single archive before uploading
- **Clipboard integration** — The download URL is automatically copied to your clipboard
- **Toast notifications** — Get notified when the upload starts and completes
- **No console window** — Runs silently in the background

## Installation

### From Release

1. Download `MagicodeUploader-Setup.exe` from the [latest release](../../releases/latest)
2. Run the installer

The installer will automatically set up the context menu, enable Developer Mode for Win11 support (a UAC prompt will appear), and register all necessary components.

### Prerequisites

- **Node.js** (v18+) — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (x64)

### Uninstall

Go to **Settings > Apps > Installed apps**, find "Magicode Uploader", and click Uninstall.

## Usage

Right-click any file or folder in Windows Explorer and select **"Upload to Magicode"**.

The file will be uploaded to [send.magicode.me](https://send.magicode.me), the download URL will be copied to your clipboard, and you'll see a notification when it's done.

For multiple files, select them all, right-click, and choose "Upload to Magicode" — they'll be zipped together automatically.

### Command Line

You can also use it from the command line:

```bash
node src/main.js <file1> [file2] [file3] ...
```

## Building from Source

### Prerequisites

- Visual Studio 2022 (with C++ desktop workload)
- Windows SDK
- [Inno Setup 6](https://jrsoftware.org/isinfo.php)

### Build the native DLL

```bash
npm run build:dll
```

### Build the installer

```bash
npm install
npm run pack
```

The GitHub Action handles all of this automatically when a version tag is pushed.

## How It Works

| Component | Purpose |
|---|---|
| `src/main.js` | Uploads files, copies URL to clipboard, shows notifications |
| `src/launcher.vbs` | Launches node.exe without a console window |
| `src/win11/MagicodeNative.dll` | Native C++ IExplorerCommand handler for Win11 modern context menu |
| `AppxManifest.xml` | Sparse MSIX package for Win11 context menu identity |
| `scripts/installer.iss` | Inno Setup script that builds the single-file installer |

The Win11 modern context menu requires a native COM DLL implementing `IExplorerCommand` plus a sparse MSIX package for app identity. The classic context menu uses a simple registry-based `shell\verb\command` entry that launches `wscript.exe` with a VBScript wrapper to hide the console window.

## Releasing

Push a version tag to trigger the GitHub Action:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The action builds the native DLL, creates the installer with Inno Setup, and publishes `MagicodeUploader-Setup.exe` to GitHub Releases.

---

<div dir="rtl" align="right">

## Magicode Uploader - עברית

העלאת קבצים ל-[send.magicode.me](https://send.magicode.me) ישירות מתפריט הלחיצה הימנית בסייר הקבצים של Windows.

### תכונות

- **שילוב בסייר הקבצים** — לחיצה ימנית על כל קובץ או תיקייה ובחירה ב-"Upload to Magicode"
- **תפריט מודרני של Windows 11** — מופיע בתפריט הראשי (לא מוסתר תחת "הצג אפשרויות נוספות")
- **תפריט קלאסי** — עובד גם בתפריט הקלאסי לתאימות מלאה
- **תמיכה בקבצים מרובים** — בחירת מספר קבצים תאחד אותם לארכיון ZIP לפני ההעלאה
- **העתקה ללוח** — קישור ההורדה מועתק אוטומטית ללוח
- **התראות** — הודעה כשההעלאה מתחילה ומסתיימת
- **ללא חלון קונסול** — רץ ברקע בשקט

### התקנה

#### מגרסה מוכנה

1. הורידו את `MagicodeUploader-Setup.exe` מ[הגרסה האחרונה](../../releases/latest)
2. הריצו את קובץ ההתקנה

ההתקנה תגדיר אוטומטית את תפריט הלחיצה הימנית, תפעיל מצב מפתח לתמיכה ב-Windows 11 (תופיע בקשת UAC), ותרשום את כל הרכיבים הנדרשים.

#### דרישות מקדימות

- **Node.js** (גרסה 18 ומעלה) — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (x64)

### הסרה

היכנסו ל**הגדרות > אפליקציות > אפליקציות מותקנות**, מצאו את "Magicode Uploader" ולחצו על הסר התקנה.

### שימוש

לחצו לחיצה ימנית על כל קובץ או תיקייה בסייר הקבצים ובחרו **"Upload to Magicode"**.

הקובץ יועלה ל-[send.magicode.me](https://send.magicode.me), קישור ההורדה יועתק ללוח, ותקבלו התראה כשההעלאה תסתיים.

לקבצים מרובים — בחרו את כולם, לחצו לחיצה ימנית ובחרו "Upload to Magicode" — הם יאוחדו לקובץ ZIP אוטומטית.

</div>
