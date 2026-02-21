# Magicode Uploader - Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\MagicodeUploader"
)

$ErrorActionPreference = 'Stop'

# --- Check prerequisites ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: Node.js is required but not found in PATH." -ForegroundColor Red
    Write-Host "Download from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}
Write-Host "Node.js: $($node.Source)"

# --- Determine source directory (where this script lives) ---
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

# --- Create install directory ---
if (Test-Path $InstallDir) {
    Write-Host "Removing previous installation..."
    Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

# --- Copy application files ---
Write-Host "Copying files to $InstallDir..."

# Core source
New-Item "$InstallDir\src" -ItemType Directory -Force | Out-Null
Copy-Item "$ScriptRoot\src\main.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\upload.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\zip.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\clipboard.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\notify.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\registry.js" "$InstallDir\src\"
Copy-Item "$ScriptRoot\src\launcher.vbs" "$InstallDir\src\"

# Native DLL for Win11 context menu
New-Item "$InstallDir\src\win11\build" -ItemType Directory -Force | Out-Null
Copy-Item "$ScriptRoot\src\win11\build\MagicodeNative.dll" "$InstallDir\src\win11\build\"

# Node modules
if (Test-Path "$ScriptRoot\node_modules") {
    Copy-Item "$ScriptRoot\node_modules" "$InstallDir\node_modules" -Recurse
}

# Package files
Copy-Item "$ScriptRoot\package.json" "$InstallDir\"

# MSIX sparse package files
Copy-Item "$ScriptRoot\AppxManifest.xml" "$InstallDir\"
Copy-Item "$ScriptRoot\MagicodeUploader.exe" "$InstallDir\"
New-Item "$InstallDir\Assets" -ItemType Directory -Force | Out-Null
Copy-Item "$ScriptRoot\Assets\*" "$InstallDir\Assets\"

# Uninstaller
Copy-Item "$ScriptRoot\scripts\uninstall.ps1" "$InstallDir\uninstall.ps1"

# --- Write config with correct paths ---
$nodePath = (Get-Command node).Source -replace '\\', '\\\\'
$mainJsPath = ("$InstallDir\src\main.js") -replace '\\', '\\\\'
$configJson = @"
{
  "nodePath": "$nodePath",
  "mainJsPath": "$mainJsPath"
}
"@
Set-Content "$InstallDir\src\win11\build\magicode-config.json" $configJson -Encoding UTF8

# --- Update AppxManifest.xml with correct DLL path ---
$manifest = Get-Content "$InstallDir\AppxManifest.xml" -Raw
$manifest = $manifest -replace 'src\\win11\\build\\MagicodeNative\.dll', 'src\win11\build\MagicodeNative.dll'
Set-Content "$InstallDir\AppxManifest.xml" $manifest -Encoding UTF8

# --- Register classic context menu ---
Write-Host "Registering context menu..."
$launcherPath = "$InstallDir\src\launcher.vbs"
$command = "wscript.exe `"$launcherPath`" `"%1`""

$fileKey = 'HKCU:\Software\Classes\*\shell\MagicodeUpload'
$dirKey = 'HKCU:\Software\Classes\Directory\shell\MagicodeUpload'

# File context menu
New-Item -Path "$fileKey\command" -Force | Out-Null
Set-ItemProperty -Path $fileKey -Name '(Default)' -Value 'Upload to Magicode'
Set-ItemProperty -Path $fileKey -Name 'Icon' -Value 'imageres.dll,112'
Set-ItemProperty -Path $fileKey -Name 'MultiSelectModel' -Value 'Player'
Set-ItemProperty -Path "$fileKey\command" -Name '(Default)' -Value $command

# Directory context menu
New-Item -Path "$dirKey\command" -Force | Out-Null
Set-ItemProperty -Path $dirKey -Name '(Default)' -Value 'Upload to Magicode'
Set-ItemProperty -Path $dirKey -Name 'Icon' -Value 'imageres.dll,112'
Set-ItemProperty -Path "$dirKey\command" -Name '(Default)' -Value $command

# --- Register sparse MSIX package for Win11 modern context menu ---
Write-Host "Registering Win11 context menu (sparse package)..."
try {
    # Remove old package if exists
    Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue

    $devMode = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
    if ($devMode -eq 1) {
        Add-AppxPackage -Register "$InstallDir\AppxManifest.xml" -ExternalLocation $InstallDir
        Write-Host "  Win11 modern context menu registered." -ForegroundColor Green
    } else {
        Write-Host "  Developer Mode not enabled - Win11 modern context menu skipped." -ForegroundColor Yellow
        Write-Host "  The classic context menu (Show more options) will still work."
    }
} catch {
    Write-Host "  Win11 context menu registration failed: $_" -ForegroundColor Yellow
    Write-Host "  The classic context menu (Show more options) will still work."
}

# --- Register in Apps & Features ---
Write-Host "Registering in Apps & Features..."
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagicodeUploader'
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Magicode Uploader'
Set-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value '1.0.0'
Set-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Magicode'
Set-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $InstallDir
Set-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value "powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
Set-ItemProperty -Path $uninstallKey -Name 'QuietUninstallString' -Value "powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`" -Quiet"
Set-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'DisplayIcon' -Value 'imageres.dll,112'

Write-Host ""
Write-Host "Magicode Uploader installed successfully!" -ForegroundColor Green
Write-Host "  Location: $InstallDir"
Write-Host "  Right-click any file to see 'Upload to Magicode'"
Write-Host ""
