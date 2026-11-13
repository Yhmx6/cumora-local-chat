$ErrorActionPreference = 'Stop'
$distro = if ($env:CUMORA_WSL_DISTRO) { $env:CUMORA_WSL_DISTRO } else { 'Cumora' }
wsl.exe -d $distro -u root --exec systemctl stop cumora-agents cumora-web cumora-api
if ($LASTEXITCODE -ne 0) { throw '本机服务停止失败。' }
