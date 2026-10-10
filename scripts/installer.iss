#define MyAppName "Magicode Uploader"
#define MyAppVersion "1.2.1"
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
Source: "..\src\*.js"; DestDir: "{app}\src"; Flags: ignoreversion

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
Source: "uninstall.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Run]
; Write magicode-config.json with correct paths after install
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\write-config.ps1"" -AppDir ""{app}"""; Flags: runhidden shellexec waituntilterminated
; Register the context menu: sparse package on Win11 (enables Developer Mode if needed), classic verb otherwise
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\register-win11.ps1"" -AppDir ""{app}"""; Flags: runhidden shellexec waituntilterminated

[UninstallRun]
; Remove the sparse package and any classic context menu keys
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Quiet -KeepFiles"; Flags: runhidden shellexec waituntilterminated

[UninstallDelete]
Type: files; Name: "{app}\src\win11\build\magicode-config.json"
Type: files; Name: "{app}\upload.log"

[Code]
// The installed DLL stays loaded by the package's COM surrogate (or Explorer),
// so release it before files are replaced on upgrade.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue; ' +
    'Get-Process dllhost -ErrorAction SilentlyContinue | Where-Object { try { $_.Modules.ModuleName -contains ''MagicodeNative.dll'' } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

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
