#define MyAppName "Magicode Uploader"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Magicode"
#define MyAppURL "https://send.magicode.me"

[Setup]
AppId={{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\MagicodeUploader
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=MagicodeUploader-Setup
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\Assets\app.ico
UninstallDisplayIcon={app}\Assets\app.ico
WizardStyle=modern
DisableDirPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Source code
Source: "..\src\main.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\upload.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\zip.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\clipboard.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\notify.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\registry.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\launcher.vbs"; DestDir: "{app}\src"; Flags: ignoreversion

; Native DLL
Source: "..\src\win11\build\MagicodeNative.dll"; DestDir: "{app}\src\win11\build"; Flags: ignoreversion

; Node modules
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Package manifest
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion

; Sparse MSIX package files
Source: "..\AppxManifest.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\MagicodeUploader.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Assets\*"; DestDir: "{app}\Assets"; Flags: ignoreversion

; Install scripts
Source: "register-win11.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "write-config.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Registry]
; Classic context menu - files
Root: HKCU; Subkey: "Software\Classes\*\shell\MagicodeUpload"; ValueType: string; ValueName: ""; ValueData: "Upload to Magicode"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\*\shell\MagicodeUpload"; ValueType: string; ValueName: "Icon"; ValueData: "imageres.dll,112"
Root: HKCU; Subkey: "Software\Classes\*\shell\MagicodeUpload"; ValueType: string; ValueName: "MultiSelectModel"; ValueData: "Player"
Root: HKCU; Subkey: "Software\Classes\*\shell\MagicodeUpload\command"; ValueType: string; ValueName: ""; ValueData: "wscript.exe ""{app}\src\launcher.vbs"" ""%1"""

; Classic context menu - directories
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MagicodeUpload"; ValueType: string; ValueName: ""; ValueData: "Upload to Magicode"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MagicodeUpload"; ValueType: string; ValueName: "Icon"; ValueData: "imageres.dll,112"
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MagicodeUpload\command"; ValueType: string; ValueName: ""; ValueData: "wscript.exe ""{app}\src\launcher.vbs"" ""%1"""

[Run]
; Write magicode-config.json with correct paths after install
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\write-config.ps1"" -AppDir ""{app}"""; Flags: runhidden shellexec waituntilterminated
; Register sparse MSIX package for Win11 modern context menu (enables Developer Mode if needed)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\register-win11.ps1"" -AppDir ""{app}"""; Flags: runhidden shellexec waituntilterminated

[UninstallRun]
; Remove sparse MSIX package
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue"""; Flags: runhidden shellexec waituntilterminated

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Check if Node.js is installed
  if not Exec('cmd.exe', '/c where node', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox('Node.js is required but was not found.' #13#10#13#10 'Please install Node.js from https://nodejs.org and try again.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;
