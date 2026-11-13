const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

function fixture() {
  const handlers = new Map()
  const spawned = []
  const requests = []
  const windows = []
  class FakeWindow {
    constructor() { this.destroyed=false; this.hidden=false; windows.push(this) }
    async loadURL() {}
    hide() { this.hidden=true }
    destroy() { this.destroyed=true }
    isDestroyed() { return this.destroyed }
  }
  const frame = {url:'http://localhost:5180/'}
  const wc = {mainFrame:frame}
  const window = {isDestroyed:()=>false,webContents:wc}
  const projectRoot = path.resolve(__dirname, '..')
  const mocks = {
    electron:{BrowserWindow:FakeWindow,app:{getPath:()=>__dirname,getVersion:()=> '0.1.0'},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{openPath:async()=>''}},
    'node:fs':{existsSync:()=>true,readFileSync:file=>JSON.stringify(file.endsWith('desktop-access.json')?{key:'x'.repeat(43)}:{version:1,projectRoot}),appendFileSync:()=>{}},
    'node:child_process':{spawn:(file,args,options)=> { spawned.push({file,args,options}); const child=new EventEmitter(); child.kill=()=>{}; process.nextTick(()=>child.emit('exit',0)); return child }},
  }
  const context={module:{exports:{}},require:name=>mocks[name]||require(name),process:{resourcesPath:__dirname,env:{SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\Local'}},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({token:'session-test',companyId:'original-company',key:'must-not-return'})}},URL,AbortSignal,setTimeout,clearTimeout}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cumora-main/electron/local-desktop.cjs'),'utf8'),context)
  const desktop=context.module.exports.createLocalDesktop()
  desktop.register(()=>window)
  return {desktop,windows,handlers,spawned,requests,projectRoot,event:{sender:wc,senderFrame:frame},wc}
}
test('desktop bridge permits only the main local renderer', async()=> {
  const {handlers,event,wc}=fixture()
  const info=handlers.get('desktop:v1:info')
  assert.equal(info(event).apiVersion,1)
  assert.throws(()=>info({sender:wc,senderFrame:{url:'http://localhost:5180/'}}),/Untrusted/)
  assert.throws(()=>info({sender:{},senderFrame:event.senderFrame}),/Untrusted/)
  event.senderFrame.url='https://example.com'
  assert.throws(()=>info(event),/Untrusted/)
  event.senderFrame.url='http://localhost:5180.evil.example'
  assert.throws(()=>info(event),/Untrusted/)
})
test('concurrent start requests share one fixed script invocation',async()=> {
  const {handlers,event,spawned,projectRoot}=fixture()
  const start=handlers.get('desktop:v1:start')
  await Promise.all([start(event),start(event)])
  assert.equal(spawned.length,1)
  assert.equal(spawned[0].options.shell,false)
  assert.equal(spawned[0].options.windowsHide,true)
  assert.equal(spawned[0].args.at(-1),path.join(projectRoot,'cumora-local-config','Start-Cumora.ps1'))
})
test('extension interface has no raw execute, secret read or arbitrary IPC',()=> {
  const {handlers}=fixture()
  assert.deepEqual([...handlers.keys()].sort(),['desktop:v1:diagnostics','desktop:v1:info','desktop:v1:session','desktop:v1:start','desktop:v1:status'])
})

test('local session keeps bootstrap key in main and refuses iframe or remote requests',async()=> {
  const {handlers,event,requests,wc}=fixture()
  const login=handlers.get('desktop:v1:session')
  const session=await login(event,'https://evil.example','another-user')
  assert.equal(session.token,'session-test');assert.equal(session.companyId,'original-company')
  assert.equal(session.key,undefined)
  assert.equal(requests[0].url,'http://localhost:5181/api/auth/local-desktop')
  assert.equal(requests[0].options.redirect,'error')
  assert.equal(requests[0].options.headers['X-Cumora-Desktop-Key'],'x'.repeat(43))
  assert.throws(()=>login({sender:wc,senderFrame:{url:'http://localhost:5180/'}}),/Untrusted/)
  event.senderFrame.url='https://evil.example'
  assert.throws(()=>login(event),/Untrusted/)
})

test('startup keeps a window alive until the main window is ready',async()=> {
  const {desktop,windows}=fixture()
  assert.equal(await desktop.boot(),true)
  assert.equal(windows.length,1)
  assert.equal(windows[0].hidden,true)
  assert.equal(windows[0].destroyed,false)
  desktop.finishBoot()
  assert.equal(windows[0].destroyed,true)
  desktop.finishBoot()
})
