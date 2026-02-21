# Magicode Uploader - Uninstaller
param([switch]$Quiet)

$ErrorActionPreference = 'SilentlyContinue'

if (-not $Quiet) {
    Write-Host "Uninstalling Magicode Uploader..."
}

# --- Remove context menu entries ---
Remove-Item 'HKCU:\Software\Classes\*\shell\MagicodeUpload' -Recurse -Force
Remove-Item 'HKCU:\Software\Classes\Directory\shell\MagicodeUpload' -Recurse -Force

# --- Remove sparse MSIX package ---
Get-AppxPackage MagicodeUploader | Remove-AppxPackage -ErrorAction SilentlyContinue

# --- Remove CLSID if manually registered ---
Remove-Item 'HKCU:\Software\Classes\CLSID\{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}' -Recurse -Force

# --- Remove Apps & Features entry ---
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagicodeUploader' -Recurse -Force

# --- Remove install directory ---
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (Test-Path "$installDir\src\main.js") {
    # Confirm this is the right directory before deleting
    Remove-Item $installDir -Recurse -Force
}

if (-not $Quiet) {
    Write-Host "Magicode Uploader has been uninstalled." -ForegroundColor Green
}
