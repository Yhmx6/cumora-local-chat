import {test,before,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildApiTestApp,ensureSchemaOnce,resetAllTables,seedUserMembership,teardownAll} from './_helpers.js'
import {pool} from '../db/pool.js'
import {readRoleVault} from '../agents/computer/role-vault.js'
import {readProviderProfiles} from '../agents/computer/provider-profiles.js'
import {assignAgentToComputer} from '../agents/computer/registry.js'
import {createRoleModelBridge} from '../role-openai-bridge.js'

const company='role-test',user='role-owner',root=mkdtempSync(join(tmpdir(),'role-test-')),home=process.env.HOME
let server:Server,base=''
const config={label:'DeepSeek test',protocol:'anthropic',baseUrl:'https://api.deepseek.com/anthropic',model:'test-model',fastModel:'test-fast',authType:'bearer',apiKey:''}
before(async()=>{
  process.env.HOME=root;process.env.CUMORA_ROLE_CONNECTIONS='1'
  mkdirSync(join(root,'.cumora'),{mode:0o700})
  await ensureSchemaOnce();const app=await buildApiTestApp(user)
  app.use('/local-models',createRoleModelBridge(async(c,body)=>{
    assert.equal(c.apiKey,'new-fixture-key');assert.equal((body as any).messages[0].content[0].text,'test')
    return {choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:1}}
  }))
  await new Promise<void>(resolve=>{server=createServer(app).listen(0,()=>{const addr=server.address();if(addr&&typeof addr==='object')base=`http://127.0.0.1:${addr.port}/api`;resolve()})})
})
beforeEach(async()=>{
  await resetAllTables()
  for(const f of ['role-connections.enc','role-connections.key'])rmSync(join(root,'.cumora',f),{force:true})
  await pool.query("INSERT INTO companies(id,name,slug) VALUES($1,'Role test',$1),('other-role','Other','other-role')",[company]);await seedUserMembership(user,company)
  const profile={id:'shared',label:config.label,baseUrl:config.baseUrl,model:config.model,fastModel:config.fastModel,auth:{authToken:'fixture-private-secret'}}
  writeFileSync(join(root,'.cumora','computer.json'),JSON.stringify({computerId:'local-role'}),{mode:0o600})
  writeFileSync(join(root,'.cumora','providers.json'),JSON.stringify({version:1,profiles:[profile]}),{mode:0o600})
  await pool.query(`INSERT INTO computers(id,company_id,name,kind,available_engines,detected_engines,status) VALUES('local-role',$1,'Local','local','["claude","api"]',$2,'online')`,[company,JSON.stringify(['claude','api'].map(id=>({id,bin:id,path:'/bin/'+id,providerProfiles:[{id:'shared',label:config.label,model:config.model,fastModel:config.fastModel}]})))])
  for(const id of ['a','b'])await pool.query("INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status,computer_id,engine,provider_profile) VALUES($1,$2,'agent',$1,'A','#fff','avail','local-role','claude','shared')",[id,company])
})
after(async()=>{await teardownAll(server);if(home===undefined)delete process.env.HOME;else process.env.HOME=home;rmSync(root,{recursive:true,force:true})})
const request=(path:string,body?:unknown,tenant=company)=>fetch(base+'/role-connections'+path,{method:body?'POST':'GET',headers:{'x-company-id':tenant,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})
const state=async()=>await(await request('?agentId=a')).json() as any
test('legacy cards show existing endpoint and model, never the credential; scope and role gates apply',async()=>{
  const r=await request('?agentId=a');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store')
  const text=await r.text();assert.ok(!text.includes('fixture-private-secret'));assert.equal(JSON.parse(text).connection.hasKey,true)
  assert.equal((await request('?agentId=missing')).status,404)
  assert.equal((await request('?agentId=a',undefined,'other-role')).status,403)
  await pool.query("UPDATE company_members SET role='member' WHERE user_id=$1",[user]);assert.equal((await request('?agentId=a')).status,403)
})
test('prepare creates independent encrypted credentials and changes no active assignment until saved',async()=>{
  const old=await state()
  const r=await request('/prepare',{agentId:'a',revision:old.connection.revision,connection:{...config,model:'changed'}})
  assert.equal(r.status,200,await r.clone().text());const prepared=await r.json() as any
  const before=(await pool.query("SELECT provider_profile FROM participants WHERE id='a' AND company_id=$1",[company])).rows[0]
  assert.equal(before.provider_profile,'shared')
  assert.ok(!readFileSync(join(root,'.cumora','role-connections.enc'),'utf8').includes('fixture-private-secret'))
  const assigned=await assignAgentToComputer({agentId:'a',companyId:company,computerId:'local-role',engine:'api',inherit:false,providerProfile:prepared.providerProfile,model:'changed'})
  assert.equal(assigned?.engine,'api')
  assert.equal((await state()).connection.model,'changed')
  const b=(await pool.query("SELECT provider_profile FROM participants WHERE id='b' AND company_id=$1",[company])).rows[0]
  assert.equal(b.provider_profile,'shared')
  assert.equal(readProviderProfiles(join(root,'.cumora','providers.json')).find(p=>p.id==='shared')?.model,'test-model')
})
test('missing new key on endpoint change and stale revisions cannot mutate the vault',async()=>{
  const old=await state()
  assert.equal((await request('/prepare',{agentId:'a',revision:old.connection.revision,connection:{...config,baseUrl:'https://other.example.com'}})).status,400)
  assert.equal((await request('/prepare',{agentId:'a',revision:'stale',connection:config})).status,409)
  assert.equal(readRoleVault(join(root,'.cumora')).length,0)
})
test('new-card configuration advertises a selectable profile and retry retains the key',async()=>{
  const body={draftId:'draft-test-123',revision:'',connection:{...config,protocol:'openai',baseUrl:'https://api.openai.com/v1',apiKey:'new-fixture-key'}}
  const first=await request('/prepare',body);assert.equal(first.status,200,await first.clone().text());const out=await first.json() as any
  const retry=await request('/prepare',{...body,revision:out.connection.revision,connection:{...body.connection,apiKey:''}})
  assert.equal(retry.status,200);assert.equal((await retry.json() as any).providerProfile,out.providerProfile)
  const p=readProviderProfiles(join(root,'.cumora','providers.json')).find(p=>p.id===out.providerProfile)!
  assert.match(p.baseUrl,/127\.0\.0\.1/);assert.ok(!JSON.stringify(p).includes('new-fixture-key'))
  const row=readRoleVault(join(root,'.cumora')).find(r=>r.id===out.providerProfile)!
  const bridge=(token:string,model='test-model',stream=false)=>fetch(base.replace(/\/api$/,'')+'/local-models/'+row.id+'/v1/messages',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model,max_tokens:32,messages:[{role:'user',content:'test'}],stream})})
  assert.equal((await bridge('wrong')).status,401)
  assert.equal((await bridge(row.bridgeToken)).status,403,'prepared credentials cannot be used until assigned')
  await assignAgentToComputer({agentId:'a',companyId:company,computerId:'local-role',engine:'api',inherit:false,providerProfile:row.id,model:'test-model'})
  assert.equal((await bridge(row.bridgeToken,'wrong-model')).status,400)
  const answer=await bridge(row.bridgeToken);assert.equal(answer.status,200);assert.equal((await answer.json() as any).content[0].text,'OK')
  const stream=await bridge(row.bridgeToken,'test-model',true);assert.match(stream.headers.get('content-type')??'',/event-stream/);assert.match(await stream.text(),/event: message_stop/)
})
