# Magicode Uploader - Installer (without Inno Setup)
# Run from the repo or an unpacked release zip:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
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

# --- Source directory is the parent of the scripts folder ---
$SourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)

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
New-Item "$InstallDir\src\win11\build" -ItemType Directory -Force | Out-Null
New-Item "$InstallDir\scripts" -ItemType Directory -Force | Out-Null
New-Item "$InstallDir\Assets" -ItemType Directory -Force | Out-Null

Copy-Item "$SourceRoot\src\*.js" "$InstallDir\src\"
Copy-Item "$SourceRoot\src\win11\build\MagicodeNative.dll" "$InstallDir\src\win11\build\"
if (Test-Path "$SourceRoot\node_modules") {
    Copy-Item "$SourceRoot\node_modules" "$InstallDir\node_modules" -Recurse
}
Copy-Item "$SourceRoot\package.json" "$InstallDir\"
Copy-Item "$SourceRoot\AppxManifest.xml" "$InstallDir\"
Copy-Item "$SourceRoot\MagicodeUploader.exe" "$InstallDir\"
Copy-Item "$SourceRoot\Assets\*" "$InstallDir\Assets\"
foreach ($f in 'write-config.ps1', 'register-win11.ps1') {
    Copy-Item "$SourceRoot\scripts\$f" "$InstallDir\scripts\"
}
Copy-Item "$SourceRoot\scripts\uninstall.ps1" "$InstallDir\uninstall.ps1"

# --- Config + context menu ---
& "$InstallDir\scripts\write-config.ps1" -AppDir $InstallDir
& "$InstallDir\scripts\register-win11.ps1" -AppDir $InstallDir

# --- Register in Apps & Features ---
$version = (Get-Content "$SourceRoot\package.json" -Raw | ConvertFrom-Json).version
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagicodeUploader'
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Magicode Uploader'
Set-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value $version
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
Write-Host "  Right-click any file or folder to see 'Upload to Magicode'"
Write-Host ""
