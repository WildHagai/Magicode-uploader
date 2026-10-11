# Magicode Uploader - Uninstaller
# -KeepFiles: only unregister (used by the Inno Setup uninstaller, which deletes the files itself)
param([switch]$Quiet, [switch]$KeepFiles)

$ErrorActionPreference = 'SilentlyContinue'

if (-not $Quiet) {
    Write-Host "Uninstalling Magicode Uploader..."
}

# --- Remove sparse MSIX package ---
Get-AppxPackage MagicodeUploader | Remove-AppxPackage -ErrorAction SilentlyContinue

# --- Remove classic context menu entries and the CLSID they use ---
Remove-Item -LiteralPath 'HKCU:\Software\Classes\*\shell\MagicodeUpload' -Recurse -Force
Remove-Item -LiteralPath 'HKCU:\Software\Classes\Directory\shell\MagicodeUpload' -Recurse -Force
Remove-Item -LiteralPath 'HKCU:\Software\Classes\CLSID\{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}' -Recurse -Force

# --- Release the DLL from the package's COM surrogate so the files can be deleted ---
Get-Process dllhost |
    Where-Object { try { $_.Modules.ModuleName -contains 'MagicodeNative.dll' } catch { $false } } |
    Stop-Process -Force

if (-not $KeepFiles) {
    # --- Remove Apps & Features entry (created by install.ps1) ---
    Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagicodeUploader' -Recurse -Force

    # --- Remove install directory ---
    $installDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    if (Test-Path "$installDir\MagicodeUploader.exe") {
        Remove-Item $installDir -Recurse -Force
    }
}

if (-not $Quiet) {
    Write-Host "Magicode Uploader has been uninstalled." -ForegroundColor Green
}
