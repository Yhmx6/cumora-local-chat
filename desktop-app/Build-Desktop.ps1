$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $projectRoot 'cumora-main'
Copy-Item -LiteralPath (Join-Path $source 'electron') -Destination $PSScriptRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $source 'build') -Destination $PSScriptRoot -Recurse -Force
$config = @{version=1;projectRoot=$projectRoot} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'desktop-local.json'),$config)
Push-Location $PSScriptRoot
try {
    npm.cmd run pack
    if ($LASTEXITCODE -ne 0) { throw '桌面端打包失败' }
} finally { Pop-Location }
