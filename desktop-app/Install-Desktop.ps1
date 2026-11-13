$ErrorActionPreference = 'Stop'
$buildDirectory = Join-Path $PSScriptRoot 'release\win-unpacked'
$executableName = 'Cumora AI聊天群.exe'
if (-not (Test-Path -LiteralPath (Join-Path $buildDirectory $executableName))) { throw '请先运行 Build-Desktop.ps1 完成打包。' }
$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\CumoraLocal\0.1.0'
$executablePath = Join-Path $installDirectory $executableName
$active = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executablePath })
if ($active.Count -gt 0) { throw '请先从托盘退出 Cumora 桌面端，再重新安装。' }
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $buildDirectory | Copy-Item -Destination $installDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build\icons\icon.ico') -Destination (Join-Path $installDirectory 'cumora.ico') -Force
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcutFolders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($folder in $shortcutFolders) {
    $shortcutPath = Join-Path $folder 'Cumora AI聊天群.lnk'
    $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -and $shortcut.TargetPath -ne $executablePath) { throw "已有同名入口，请先检查：$shortcutPath" }
    $shortcut.TargetPath = $executablePath
    $shortcut.WorkingDirectory = $installDirectory
    $shortcut.IconLocation = (Join-Path $installDirectory 'cumora.ico') + ',0'
    $shortcut.Description = 'Cumora 本机 AI 聊天群桌面端'
    $shortcut.Save()
}
Write-Host "已安装：$executablePath"
Write-Host '桌面和开始菜单入口已创建。'
