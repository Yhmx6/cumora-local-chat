$ErrorActionPreference = 'Stop'
$distro = if ($env:CUMORA_WSL_DISTRO) { $env:CUMORA_WSL_DISTRO } else { 'Cumora' }
wsl.exe -d $distro -u root --exec systemctl start cumora-api cumora-web cumora-agents
if ($LASTEXITCODE -ne 0) { throw '本机服务启动失败，请先配置 WSL 中的 Cumora 服务。' }
