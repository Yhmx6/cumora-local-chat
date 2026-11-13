/* Local desktop integration. No credentials or arbitrary shell API enter IPC. */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

function loadConfig() {
  const file = path.join(process.resourcesPath, 'desktop-local.json')
  if (!fs.existsSync(file)) return null
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (config.version !== 1 || !path.isAbsolute(config.projectRoot)) throw new Error('Invalid local desktop configuration')
  return Object.freeze({ projectRoot: config.projectRoot, rendererUrl: 'http://localhost:5180', apiUrl: 'http://localhost:5181' })
}

function createLocalDesktop() {
  const config = loadConfig()
  if (!config) return null
  let starting = null
  let bootWindow = null
  let getMainWindow = () => null
  const logPath = () => path.join(app.getPath('userData'), 'desktop-service.log')
  const log = message => { fs.appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`) }
  const scriptFor = action => path.join(config.projectRoot, 'cumora-local-config', action === 'start' ? 'Start-Cumora.ps1' : 'Stop-Cumora.ps1')

  async function probe(url) {
    try { return (await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' })).ok }
    catch { return false }
  }
  async function status() {
    const [api, chat] = await Promise.all([probe(`${config.apiUrl}/api/health`), probe(config.rendererUrl)])
    return { api, chat, starting: !!starting }
  }
  function runScript(action) {
    return new Promise((resolve, reject) => {
      const script = scriptFor(action)
      if (!fs.existsSync(script)) return reject(new Error('找不到本机服务文件，请确认 AI聊天群 项目文件夹没有移动。'))
      const child = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, shell: false, stdio: 'ignore', cwd: config.projectRoot })
      log(`${action}: launched`)
      const timer = setTimeout(() => { child.kill(); reject(new Error('启动等待超时，请稍后重试；可以从托盘打开诊断记录。')) }, 180000)
      child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动本机服务程序。')) })
      child.once('exit', code => {
        clearTimeout(timer)
        log(`${action}: exit ${code}`)
        if (code === 0) resolve()
        else reject(new Error('本机服务未能启动，请确认 WSL 和网络代理可用。'))
      })
    })
  }
  async function start() {
    if (starting) return starting
    starting = (async () => {
      await runScript('start')
      const deadline = Date.now() + 45000
      while (Date.now() < deadline) {
        const current = await status()
        if (current.api && current.chat) { log('services ready'); return {ready:true} }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      throw new Error('聊天页面尚未就绪，请稍后重试。')
    })().finally(() => { starting = null })
    return starting
  }
  function isTrusted(event) {
    const win = getMainWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false
    try { return new URL(event.senderFrame.url).origin === config.rendererUrl } catch { return false }
  }
  async function localSession() {
    // Fixed file and endpoint: renderer cannot choose an account, path or URL.
    if (!process.env.LOCALAPPDATA) throw new Error('本机身份配置不可用')
    const file = path.join(process.env.LOCALAPPDATA, 'Cumora', 'desktop-access.json')
    if (!fs.existsSync(file)) throw new Error('尚未配置本机自动进入')
    const { key } = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(key)) throw new Error('本机身份配置无效')
    const response = await fetch(`${config.apiUrl}/api/auth/local-desktop`, {
      method:'POST', headers:{'X-Cumora-Desktop-Key':key}, redirect:'error', signal:AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error('本机自动进入失败，请稍后重试或使用账号登录')
    const session = await response.json()
    if (typeof session.token !== 'string' || typeof session.companyId !== 'string') throw new Error('本机身份校验响应无效')
    return {token:session.token,companyId:session.companyId}
  }
  function register(getWindow) {
    getMainWindow = getWindow
    const handle = (name, fn) => ipcMain.handle(`desktop:v1:${name}`, (event) => {
      if (!isTrusted(event)) throw new Error('Untrusted desktop request')
      return fn()
    })
    handle('info', () => ({ apiVersion:1, version:app.getVersion(), mode:'local', capabilities:['services.status','services.start','diagnostics.open'], apiUrl:config.apiUrl }))
    handle('status', status)
    handle('session', localSession)
    handle('start', start)
    handle('diagnostics', () => { log('diagnostics opened'); return shell.openPath(logPath()) })
  }
  function protectWindow(win) {
    const allowed = url => { try { return new URL(url).origin === config.rendererUrl } catch { return false } }
    win.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    win.webContents.on('will-attach-webview', event => event.preventDefault())
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  }
  async function boot() {
    const splash = bootWindow = new BrowserWindow({width:440,height:240,resizable:false,closable:false,frame:true,title:'Cumora AI聊天群',autoHideMenuBar:true,
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})
    const html = '<!doctype html><meta charset="utf-8"><style>body{font:15px "Microsoft YaHei",sans-serif;background:#f5f5f5;color:#292929;padding:28px}h2{font-size:23px}p{color:#666;line-height:1.8}progress{width:100%;accent-color:#07c160}</style><h2>Cumora AI聊天群</h2><p>正在启动聊天服务…<br>首次启动可能需要稍等片刻。</p><progress></progress>'
    await splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    let ready = false
    while (!ready) {
      try { await start(); ready = true }
      catch (error) {
        log('startup failed')
        const result = await dialog.showMessageBox(splash, {type:'error',title:'暂时无法启动',message:error.message,buttons:['重试','退出'],defaultId:0,cancelId:1})
        if (result.response !== 0) { splash.destroy(); app.quit(); return false }
      }
    }
    // Keep one window alive until the main window exists. Destroying the
    // last window here triggers Windows' window-all-closed -> app.quit().
    splash.hide()
    return true
  }
  function finishBoot() {
    if (bootWindow && !bootWindow.isDestroyed()) bootWindow.destroy()
    bootWindow = null
  }
  async function stopAndQuit() {
    const result = await dialog.showMessageBox({type:'question',title:'停止聊天服务',message:'停止后，所有 AI 都会暂停运行。下次打开桌面端会重新启动。',buttons:['取消','停止并退出'],defaultId:0,cancelId:0})
    if (result.response !== 1) return
    try { await runScript('stop'); app.quit() }
    catch (error) { dialog.showErrorBox('停止失败', error.message) }
  }
  return { ...config, boot, finishBoot, register, protectWindow, isTrusted, stopAndQuit,
    openDiagnostics: () => { log('diagnostics opened'); return shell.openPath(logPath()) } }
}
module.exports = { createLocalDesktop }
