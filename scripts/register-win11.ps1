# Register the "Upload to Magicode" context menu.
#
# Preferred: the sparse MSIX package, which puts the command in the Windows 11
# context menu (and in "Show more options"). Registering an unsigned sparse
# package needs Developer Mode, which is enabled here if needed (UAC prompt).
#
# Fallback (Windows 10, or Developer Mode declined): a classic HKCU verb that
# loads the same IExplorerCommand DLL, so it still gets the whole selection in
# a single call. The classic verb is removed when the package registers, so the
# command never appears twice.
param(
    [Parameter(Mandatory=$true)]
    [string]$AppDir
)

$ErrorActionPreference = 'Stop'

$clsid = '{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}'
$dllPath = Join-Path $AppDir 'src\win11\build\MagicodeNative.dll'
$verbKeys = @(
    'HKCU:\Software\Classes\*\shell\MagicodeUpload',
    'HKCU:\Software\Classes\Directory\shell\MagicodeUpload'
)
$clsidKey = "HKCU:\Software\Classes\CLSID\$clsid"

function Remove-ClassicMenu {
    foreach ($k in $verbKeys + $clsidKey) {
        if (Test-Path -LiteralPath $k) { Remove-Item -LiteralPath $k -Recurse -Force }
    }
}

function Register-ClassicMenu {
    Remove-ClassicMenu
    New-Item -Path "$clsidKey\InprocServer32" -Force | Out-Null
    Set-ItemProperty -LiteralPath $clsidKey -Name '(Default)' -Value 'Magicode Upload Handler'
    Set-ItemProperty -LiteralPath "$clsidKey\InprocServer32" -Name '(Default)' -Value $dllPath
    Set-ItemProperty -LiteralPath "$clsidKey\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'
    foreach ($k in $verbKeys) {
        New-Item -Path $k -Force | Out-Null
        Set-ItemProperty -LiteralPath $k -Name 'ExplorerCommandHandler' -Value $clsid
        Set-ItemProperty -LiteralPath $k -Name 'MultiSelectModel' -Value 'Player'
    }
}

function Test-DeveloperMode {
    $v = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
    return $v -eq 1
}

$isWin11 = [Environment]::OSVersion.Version.Build -ge 22000

# Remove any existing registration so its DLL is released before re-registering.
Get-AppxPackage MagicodeUploader -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue

$packaged = $false
if ($isWin11) {
    if (-not (Test-DeveloperMode)) {
        $enableScript = @"
New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord -Force
"@
        $encodedCmd = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($enableScript))
        try {
            Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -EncodedCommand $encodedCmd" -Verb RunAs -Wait -ErrorAction Stop
        } catch {
            Write-Host "Developer Mode was not enabled: $_"
        }
    }

    if (Test-DeveloperMode) {
        try {
            Add-AppxPackage -Register (Join-Path $AppDir 'AppxManifest.xml') -ExternalLocation $AppDir
            $packaged = $true
        } catch {
            Write-Host "Sparse package registration failed: $_"
        }
    }
}

if ($packaged) {
    Remove-ClassicMenu
    Write-Host 'Windows 11 context menu registered.'
} else {
    Register-ClassicMenu
    Write-Host 'Classic context menu registered (under "Show more options" on Windows 11).'
}
