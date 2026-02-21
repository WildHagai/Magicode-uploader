# Register sparse MSIX package for Win11 modern context menu
# Enables Developer Mode if needed (requires elevation)
param(
    [Parameter(Mandatory=$true)]
    [string]$AppDir
)

$ErrorActionPreference = 'Stop'

# Remove any existing registration
try {
    Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
} catch {}

# Check if Developer Mode is enabled
$regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$devMode = (Get-ItemProperty $regPath -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense

if ($devMode -ne 1) {
    # Enable Developer Mode via elevated process
    $enableScript = @"
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord -Force
if (-not (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock')) {
    New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Force | Out-Null
}
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord -Force
"@
    $encodedCmd = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($enableScript))
    $proc = Start-Process powershell.exe -ArgumentList "-NoProfile -EncodedCommand $encodedCmd" -Verb RunAs -Wait -PassThru -ErrorAction Stop
    if ($proc.ExitCode -ne 0) {
        Write-Error "Failed to enable Developer Mode"
        exit 1
    }
}

# Register the sparse MSIX package
$manifest = Join-Path $AppDir 'AppxManifest.xml'
Add-AppxPackage -Register $manifest -ExternalLocation $AppDir

Write-Host "Win11 context menu registered successfully"
