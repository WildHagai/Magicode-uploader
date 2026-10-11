# Magicode Uploader - Installer (without Inno Setup)
# Build first (npm run build, npm run build:dll), then from the repo:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\MagicodeUploader"
)

$ErrorActionPreference = 'Stop'

# --- Source directory is the parent of the scripts folder ---
$SourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)

$exe = "$SourceRoot\src\MagicodeUploader\bin\Release\net48\MagicodeUploader.exe"
$dll = "$SourceRoot\src\win11\build\MagicodeNative.dll"
foreach ($f in $exe, $dll) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: $f not found. Run 'npm run build' and 'npm run build:dll' first." -ForegroundColor Red
        exit 1
    }
}

# --- Release the previous installation's DLL before replacing files ---
Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
Get-Process dllhost -ErrorAction SilentlyContinue |
    Where-Object { try { $_.Modules.ModuleName -contains 'MagicodeNative.dll' } catch { $false } } |
    Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path $InstallDir) {
    Write-Host "Removing previous installation..."
    Remove-Item $InstallDir -Recurse -Force
}

# --- Copy application files ---
Write-Host "Copying files to $InstallDir..."
New-Item "$InstallDir\scripts" -ItemType Directory -Force | Out-Null
New-Item "$InstallDir\Assets" -ItemType Directory -Force | Out-Null

Copy-Item $exe "$InstallDir\"
Copy-Item $dll "$InstallDir\"
Copy-Item "$SourceRoot\AppxManifest.xml" "$InstallDir\"
Copy-Item "$SourceRoot\Assets\*" "$InstallDir\Assets\"
Copy-Item "$SourceRoot\scripts\register-win11.ps1" "$InstallDir\scripts\"
Copy-Item "$SourceRoot\scripts\uninstall.ps1" "$InstallDir\uninstall.ps1"

# --- Context menu ---
& "$InstallDir\scripts\register-win11.ps1" -AppDir $InstallDir

# --- Register in Apps & Features ---
$version = (Get-Item $exe).VersionInfo.ProductVersion
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagicodeUploader'
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Magicode Uploader'
Set-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value $version
Set-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Magicode Uploader contributors'
Set-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $InstallDir
Set-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value "powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
Set-ItemProperty -Path $uninstallKey -Name 'QuietUninstallString' -Value "powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`" -Quiet"
Set-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'DisplayIcon' -Value "$InstallDir\MagicodeUploader.exe"

Write-Host ""
Write-Host "Magicode Uploader installed successfully!" -ForegroundColor Green
Write-Host "  Location: $InstallDir"
Write-Host "  Right-click any file or folder to see 'Upload to Magicode'"
Write-Host ""
