# Write magicode-config.json with correct node and main.js paths
param(
    [Parameter(Mandatory=$true)]
    [string]$AppDir
)

$ErrorActionPreference = 'Stop'

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    $nodePath = 'node.exe'
}

$mainJsPath = Join-Path $AppDir 'src\main.js'
$configDir = Join-Path $AppDir 'src\win11\build'
$configPath = Join-Path $configDir 'magicode-config.json'

if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$config = @{
    nodePath = $nodePath
    mainJsPath = $mainJsPath
} | ConvertTo-Json

Set-Content -Path $configPath -Value $config -Encoding UTF8

Write-Host "Config written to: $configPath"
Write-Host "  nodePath: $nodePath"
Write-Host "  mainJsPath: $mainJsPath"
