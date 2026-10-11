# Register the "Upload to Magicode" context menu.
#
# Preferred: the sparse MSIX package, which puts the command in the Windows 11
# context menu (and in "Show more options"). Registering an unsigned sparse
# package needs Developer Mode, which is enabled here if needed (UAC prompt)
# unless -NoDeveloperMode is given (the installer asks the user first).
#
# Fallback (Windows 10, or Developer Mode declined): a classic HKCU verb that
# loads the same IExplorerCommand DLL, so it still gets the whole selection in
# a single call. The classic verb is removed when the package registers, so the
# command never appears twice.
param(
    [Parameter(Mandatory=$true)]
    [string]$AppDir,
    [switch]$NoDeveloperMode
)

$ErrorActionPreference = 'Stop'

$clsid = '{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}'
$dllPath = Join-Path $AppDir 'MagicodeNative.dll'
$verbKeys = @(
    'HKCU:\Software\Classes\*\shell\MagicodeUpload',
    'HKCU:\Software\Classes\Directory\shell\MagicodeUpload'
)
$clsidKey = "HKCU:\Software\Classes\CLSID\$clsid"

# "Magicode: recent links" submenu on folder and desktop backgrounds
$recentClsid = '{7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6072}'
$recentVerbKeys = @(
    'HKCU:\Software\Classes\Directory\Background\shell\MagicodeRecent',
    'HKCU:\Software\Classes\DesktopBackground\shell\MagicodeRecent'
)
$recentClsidKey = "HKCU:\Software\Classes\CLSID\$recentClsid"

function Remove-ClassicMenu {
    foreach ($k in $verbKeys + $clsidKey + $recentVerbKeys + $recentClsidKey) {
        if (Test-Path -LiteralPath $k) { Remove-Item -LiteralPath $k -Recurse -Force }
    }
}

function Register-Class($key, $name) {
    New-Item -Path "$key\InprocServer32" -Force | Out-Null
    Set-ItemProperty -LiteralPath $key -Name '(Default)' -Value $name
    Set-ItemProperty -LiteralPath "$key\InprocServer32" -Name '(Default)' -Value $dllPath
    Set-ItemProperty -LiteralPath "$key\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment'
}

function Register-ClassicMenu {
    Remove-ClassicMenu
    Register-Class $clsidKey 'Magicode Upload Handler'
    Register-Class $recentClsidKey 'Magicode Recent Links'
    foreach ($k in $verbKeys) {
        New-Item -Path $k -Force | Out-Null
        Set-ItemProperty -LiteralPath $k -Name 'ExplorerCommandHandler' -Value $clsid
        Set-ItemProperty -LiteralPath $k -Name 'MultiSelectModel' -Value 'Player'
    }
    foreach ($k in $recentVerbKeys) {
        New-Item -Path $k -Force | Out-Null
        Set-ItemProperty -LiteralPath $k -Name 'ExplorerCommandHandler' -Value $recentClsid
        # An empty SubCommands value makes the classic menu show it as a submenu.
        Set-ItemProperty -LiteralPath $k -Name 'SubCommands' -Value ''
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
    if (-not (Test-DeveloperMode) -and -not $NoDeveloperMode) {
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
