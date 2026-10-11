#define MyAppName "Magicode Uploader"
#define MyAppVersion "1.3.0"
#define MyAppPublisher "Magicode Uploader contributors"
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
UninstallDisplayIcon={app}\MagicodeUploader.exe
WizardStyle=modern
DisableDirPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; Files of the Node.js versions (1.2.x and earlier)
Type: filesandordirs; Name: "{app}\src"
Type: filesandordirs; Name: "{app}\node_modules"
Type: files; Name: "{app}\package.json"
Type: files; Name: "{app}\scripts\write-config.ps1"

[Files]
; The uploader, and the context-menu handler that launches it (they must stay side by side)
Source: "..\src\MagicodeUploader\bin\Release\net48\MagicodeUploader.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\win11\build\MagicodeNative.dll"; DestDir: "{app}"; Flags: ignoreversion

; Sparse MSIX package files
Source: "..\AppxManifest.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Assets\*"; DestDir: "{app}\Assets"; Flags: ignoreversion

; Install scripts
Source: "register-win11.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Run]
; Register the context menu: sparse package on Win11 (enables Developer Mode if needed), classic verb otherwise
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\register-win11.ps1"" -AppDir ""{app}"" {code:DeveloperModeArg}"; Flags: runhidden shellexec waituntilterminated

[UninstallRun]
; Remove the sparse package and any classic context menu keys
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -Quiet -KeepFiles"; Flags: runhidden shellexec waituntilterminated

[UninstallDelete]
Type: files; Name: "{app}\upload.log"

[Code]
var
  DeveloperModePage: TInputOptionWizardPage;

// The Windows 11 top-level menu needs Developer Mode for this (unsigned) app package.
function NeedsDeveloperMode(): Boolean;
var
  Version: TWindowsVersion;
  Enabled: Cardinal;
begin
  GetWindowsVersionEx(Version);
  Result := (Version.Build >= 22000) and not
    (RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock', 'AllowDevelopmentWithoutDevLicense', Enabled) and (Enabled = 1));
end;

// Ask before changing a system setting, instead of just showing a UAC prompt.
procedure InitializeWizard();
begin
  DeveloperModePage := CreateInputOptionPage(wpWelcome,
    'Windows 11 context menu', 'Where should "Upload to Magicode" appear?',
    'To appear in the main Windows 11 right-click menu, this app needs Windows Developer Mode, ' +
    'a standard Windows setting (Settings > System > For developers) that allows installing apps from outside the Microsoft Store. ' +
    'Turning it on asks for administrator permission.' #13#10#13#10 +
    'Without it, "Upload to Magicode" appears under "Show more options" instead, and works the same.',
    False, False);
  DeveloperModePage.Add('Turn on Developer Mode and show it in the main menu');
  DeveloperModePage.Values[0] := True;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = DeveloperModePage.ID) and not NeedsDeveloperMode();
end;

function DeveloperModeArg(Param: String): String;
begin
  if NeedsDeveloperMode() and not DeveloperModePage.Values[0] then
    Result := '-NoDeveloperMode'
  else
    Result := '';
end;

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
  Release: Cardinal;
begin
  // .NET Framework 4.8 ships with Windows 10 1903+ and Windows 11; older Windows 10 may need it installed.
  if not RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) or (Release < 528040) then
  begin
    MsgBox('Magicode Uploader needs .NET Framework 4.8, which was not found.' #13#10#13#10 'Please install it from https://dotnet.microsoft.com/download/dotnet-framework/net48 and try again.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;
