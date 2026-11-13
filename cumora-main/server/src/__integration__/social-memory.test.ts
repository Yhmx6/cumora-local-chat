import { test,before,beforeEach,after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer,request as httpRequest,type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { buildApiTestApp,ensureSchemaOnce,resetAllTables,seedUserMembership,teardownAll } from './_helpers.js'
import { pool } from '../db/pool.js'
import { addSocialMemory,changeSocialMemory,listSocialMemories,socialMemoryContext,setSocialMemoryEnabled } from '../agents/social-memory.js'
import { localDesktopKeyValid } from '../local-desktop-auth.js'
import { resolveSession } from '../auth.js'
import { runCli } from '../agents/cli.js'
import { signAgentToken } from '../agents/runtime/jwt.js'

const company='social-test',user='social-owner', key='x'.repeat(43)
let server:Server,base=''
before(async () => {
  await ensureSchemaOnce()
  const app=await buildApiTestApp(user)
  const {runtimeRouter}=await import('../agents/runtime/server.js')
  app.use('/runtime',runtimeRouter)
  await new Promise<void>(resolve => {server=createServer(app).listen(0,() => {const a=server.address();if(a && typeof a==='object')base=`http://127.0.0.1:${a.port}`;resolve()})})
})
beforeEach(async () => {
  await resetAllTables()
  await pool.query("INSERT INTO companies(id,name,slug) VALUES($1,'Social test',$1),('foreign-test','Foreign','foreign-test')",[company])
  await seedUserMembership(user,company)
  for(const id of ['a','b']) await pool.query("INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status) VALUES($1,$2,'agent',$1,'A','#fff','avail')",[id,company])
  for(const id of ['room','private']) {
    await pool.query("INSERT INTO conversations(id,company_id,kind,title,members) VALUES($1,$2,'group',$1,$3)",[id,company,JSON.stringify(id==='room'?['a','b',user]:['a'])])
    await pool.query("INSERT INTO messages(id,company_id,conversation_id,author_id,kind,body,sequence) VALUES($1,$2,$3,'a','text',$4,1)",['msg-'+id,company,id,id==='room'?'我喜欢短回复':'私人偏好'])
  }
  process.env.LOCAL_DESKTOP_KEY_HASH=createHash('sha256').update(key).digest('hex')
  process.env.LOCAL_DESKTOP_USER_ID=user;process.env.LOCAL_DESKTOP_COMPANY_ID=company
})
after(async () => {await teardownAll(server)})
const auto=(room='room',agentId='a') => addSocialMemory({company,agentId,body:room==='room'?'用户喜欢短回复':'私人偏好',kind:'preference',conversationId:room,sourceMessageId:'msg-'+room})
const request=(path:string,method='GET',body?:unknown,tenant=company) => fetch(`${base}/api/agents/a/social-memories${path}`,{method,headers:{'x-company-id':tenant,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})

test('per-agent and per-conversation recall; private sources are hidden from nonmembers',async()=>{
  await auto();await auto('private')
  const visible=await listSocialMemories(company,'a',user)
  assert.equal(visible.memories.length,1);assert.equal(visible.memories[0].sourceExcerpt,'我喜欢短回复')
  assert.equal((await listSocialMemories(company,'b',user)).memories.length,0)
  assert.ok(!(await socialMemoryContext(company,'a',['room'])).includes('私人偏好'))
  assert.ok((await socialMemoryContext(company,'a',['room'])).includes('用户喜欢短回复'))
  await assert.rejects(auto('private','b'),/无权/)
  await assert.rejects(listSocialMemories('foreign-test','a',user),/找不到/)
})
test('edits use revisions; deletion clears content and prevents source resurrection',async()=>{
  const m=await auto()
  await changeSocialMemory(company,'a',user,m.id,1,{body:'只在闲聊时简短',kind:'preference'})
  await assert.rejects(changeSocialMemory(company,'a',user,m.id,1,{body:'覆盖',kind:'event'}),/已改变/)
  assert.equal((await auto()).saved,false)
  assert.ok((await socialMemoryContext(company,'a',['room'])).includes('只在闲聊时简短'))
  await changeSocialMemory(company,'a',user,m.id,2,null)
  assert.equal((await auto()).saved,false)
  assert.equal((await listSocialMemories(company,'a',user)).memories.length,0)
  const row=(await pool.query('SELECT body,source_excerpt FROM agent_social_memories WHERE id=$1',[m.id])).rows[0]
  assert.equal(row.body,'');assert.equal(row.source_excerpt,null)
  assert.ok(!(await socialMemoryContext(company,'a',['room'])).includes('只在闲聊时简短'))
})
test('pause disables automatic writes and recall but preserves manual management',async()=>{
  await auto();await setSocialMemoryEnabled(company,'a',false)
  assert.match(await socialMemoryContext(company,'a',['room']),/已暂停/)
  await assert.rejects(auto(),/已暂停/)
  await addSocialMemory({company,agentId:'a',userId:user,body:'手动资料',kind:'event',conversationId:null})
  assert.equal((await listSocialMemories(company,'a',user)).memories.length,2)
  await setSocialMemoryEnabled(company,'a',true)
  assert.match(await socialMemoryContext(company,'a',[]),/手动资料/)
  assert.ok(!(await socialMemoryContext(company,'a',[])).includes('用户喜欢短回复'))
})
test('auto save requires a real source and concurrent requests deduplicate',async()=>{
  await assert.rejects(addSocialMemory({company,agentId:'a',body:'假资料',kind:'event',conversationId:'room',sourceMessageId:'missing'}),/来源消息/)
  const results=await Promise.all([auto(),auto()])
  assert.equal(results.filter(r=>r.saved).length,1)
  await assert.rejects(addSocialMemory({company,agentId:'a',body:'假资料',kind:'event',conversationId:null}),/来源消息/)
  await pool.query("UPDATE messages SET delivery_recipient_id='b' WHERE id='msg-private'")
  await assert.rejects(auto('private'),/来源消息/)
})
test('management HTTP CRUD and workspace authorization',async()=>{
  const created=await request('','POST',{body:'手动测试',kind:'preference',conversationId:null})
  assert.equal(created.status,200);const m=await created.json() as {id:string}
  assert.equal((await request('/'+m.id,'PUT',{body:'修改成功',kind:'event',revision:1})).status,200)
  const listed=await (await request('')).json() as {memories:Array<{body:string}>}
  assert.equal(listed.memories[0].body,'修改成功')
  assert.equal((await request('/'+m.id,'DELETE',{revision:2})).status,200)
  assert.equal((await request('','GET',undefined,'foreign-test')).status,403)
  await pool.query("UPDATE company_members SET role='member' WHERE user_id=$1",[user])
  assert.equal((await request('')).status,403)
})
test('agent command saves memory and authenticated runtime retrieves only authorized rooms',async()=>{
  const command=await runCli(['--as','a','memory','remember','用户喜欢短回复','--kind','preference','--in','room','--source','msg-room'])
  assert.equal(command.ok,true,command.text)
  const recall=await runCli(['--as','a','memory','recall','--in','room'])
  assert.equal(recall.ok,true);assert.match(recall.text,/用户喜欢短回复/)
  const placement=(await pool.query("SELECT computer_id,runtime_assignment_id FROM participants WHERE id='b' AND company_id=$1",[company])).rows[0]
  const token=signAgentToken({agentId:'b',companyId:company,computerId:placement.computer_id,assignmentId:placement.runtime_assignment_id})
  const read=(ids:string[],auth=token)=>fetch(base+'/runtime/social-memory-context',{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify({conversationIds:ids,agentId:'a'})})
  assert.equal((await read(['room'],'invalid')).status,401)
  assert.equal((await read(['private'])).status,403)
  const own=await read(['room']);assert.equal(own.status,200)
  assert.ok(!(await own.text()).includes('用户喜欢短回复'))
})
test('local desktop requires configured strong key, main-process headers and original active owner',async()=>{
  const post=(headers:Record<string,string>)=>new Promise<Response>((resolve,reject)=>{
    const req=httpRequest(base+'/api/auth/local-desktop',{method:'POST',headers:{host:'localhost:5181',...headers}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk});res.on('end',()=>resolve(new Response(body,{status:res.statusCode})))
    });req.on('error',reject);req.end()
  })
  assert.equal(localDesktopKeyValid('',process.env.LOCAL_DESKTOP_KEY_HASH),false)
  assert.equal(localDesktopKeyValid(key,'bad'),false)
  assert.equal((await post({})).status,403)
  assert.equal((await post({'x-cumora-desktop-key':'z'.repeat(43)})).status,403)
  assert.equal((await post({'x-cumora-desktop-key':key,origin:'http://localhost:5180'})).status,403)
  assert.equal((await post({'x-cumora-desktop-key':key,host:'evil.example'})).status,403)
  const ok=await post({'x-cumora-desktop-key':key});assert.equal(ok.status,200)
  const session=await ok.json() as {token:string;companyId:string}
  assert.equal(session.companyId,company);assert.deepEqual(await resolveSession(session.token),{userId:user})
  await pool.query('UPDATE users SET suspended_at=NOW() WHERE id=$1',[user])
  assert.equal((await post({'x-cumora-desktop-key':key})).status,403)
  delete process.env.LOCAL_DESKTOP_KEY_HASH
  assert.equal((await post({'x-cumora-desktop-key':key})).status,404)
})
