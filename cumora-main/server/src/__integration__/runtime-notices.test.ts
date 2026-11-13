import {test,before,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {buildApiTestApp,ensureSchemaOnce,resetAllTables,seedUserMembership,teardownAll} from './_helpers.js'
import {pool} from '../db/pool.js'
import {inprocClient} from '../agents/runtime/inproc-client.js'
import {RUNTIME_NOTICES_SQL} from '../db/migrations/0017-runtime-notices.js'
import {isRuntimeNotice} from '../../../shared/runtime-notices.js'
let server:Server,base=''
before(async()=>{await ensureSchemaOnce();const app=await buildApiTestApp('log-owner');await new Promise<void>(resolve=>{server=createServer(app).listen(0,()=>{const a=server.address();if(a&&typeof a==='object')base=`http://127.0.0.1:${a.port}/api/runtime-logs`;resolve()})})})
beforeEach(async()=>{
  await resetAllTables()
  await pool.query("INSERT INTO companies(id,name,slug) VALUES('logs','Logs','logs'),('other-logs','Other','other-logs')")
  await seedUserMembership('log-owner','logs')
  await pool.query("INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status) VALUES('agent','logs','agent','Claude','C','#fff','avail')")
  await pool.query("INSERT INTO conversations(id,company_id,kind,title,members) VALUES('room','logs','group','Test room','[]')")
  await pool.query("INSERT INTO conversation_members(conversation_id,company_id,participant_id,ordinal) VALUES('room','logs','agent',0),('room','logs','log-owner',1)")
})
after(async()=>await teardownAll(server))
const notice={conversationId:'room',companyId:'logs',agentId:'agent',noticeKind:'byoa_engine_failed',text:'HTTP 403: Endpoint is unavailable',dedupeKey:'failure',dedupeTtlSec:60}
const get=(suffix='',company='logs')=>fetch(base+suffix,{headers:{'x-company-id':company}})
test('runtime errors are stored once without chat messages, counters, broadcasts or room activity',async()=>{
  const before=(await pool.query("SELECT updated_at FROM conversations WHERE id='room'")).rows[0].updated_at
  const results=await Promise.all([inprocClient.postSystemNotice(notice),inprocClient.postSystemNotice(notice)])
  assert.equal(results.filter(r=>r.posted).length,1);assert.ok(results.every(r=>r.authorized))
  for(const table of ['messages','conversation_counters','realtime_outbox'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0)
  assert.equal((await pool.query('SELECT count(*)::int n FROM runtime_notices')).rows[0].n,1)
  assert.equal((await pool.query("SELECT updated_at FROM conversations WHERE id='room'")).rows[0].updated_at.toISOString(),before.toISOString())
})
test('logging still requires an active agent and conversation membership in the same workspace',async()=>{
  assert.equal((await inprocClient.postSystemNotice({...notice,companyId:'other-logs'})).authorized,false)
  await pool.query("DELETE FROM conversation_members WHERE conversation_id='room'")
  assert.equal((await inprocClient.postSystemNotice(notice)).authorized,false)
  assert.equal((await pool.query('SELECT count(*)::int n FROM runtime_notices')).rows[0].n,0)
})
test('historical errors copy into logs safely, preserve originals and hide only diagnostic system notices',async()=>{
  const body=JSON.stringify({kind:'notice',noticeKind:'byoa_engine_failed',text:'Old failure'})
  for(const [id,text]of [['old',body],['bad','{broken'],['joined','{"kind":"joined","participantId":"agent"}']])await pool.query("INSERT INTO messages(id,conversation_id,company_id,author_id,kind,body,sequence) VALUES($1,'room','logs','agent','system',$2,1)",[id,text])
  const backfill=RUNTIME_NOTICES_SQL.slice(RUNTIME_NOTICES_SQL.indexOf('CREATE FUNCTION')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
  await pool.query(backfill);await pool.query(backfill)
  assert.equal((await pool.query('SELECT count(*)::int n FROM runtime_notices')).rows[0].n,1)
  assert.equal((await pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,3)
  const chat=await fetch(base.replace('/runtime-logs','/conversations/room/messages'),{headers:{'x-company-id':'logs'}})
  assert.equal(chat.status,200)
  const chatRows=await chat.json() as any
  assert.ok(!JSON.stringify(chatRows).includes('Old failure'))
  assert.equal(isRuntimeNotice({kind:'system',body}),true)
  assert.equal(isRuntimeNotice({kind:'text',body}),false)
  assert.equal(isRuntimeNotice({kind:'system',body:'{"kind":"joined"}'}),false)
  assert.equal(isRuntimeNotice({kind:'system',body:'{broken'}),false)
})
test('log page is workspace scoped, admin gated and paginates tied timestamps without duplicates',async()=>{
  await pool.query("INSERT INTO runtime_notices(id,company_id,conversation_id,agent_id,notice_kind,text) SELECT 'log-'||i,'logs','room','agent','failure','test' FROM generate_series(1,102) i")
  const response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
  const page=await response.json() as any;assert.equal(page.rows.length,100);assert.equal(page.rows[0].agentName,'Claude')
  const next=await(await get('?'+new URLSearchParams({before:page.next.at,beforeId:page.next.id}))).json() as any
  assert.equal(next.rows.length,2);assert.equal(new Set([...page.rows,...next.rows].map(r=>r.id)).size,102)
  assert.equal((await get('','other-logs')).status,403)
  await pool.query("UPDATE company_members SET role='member' WHERE user_id='log-owner'")
  assert.equal((await get()).status,403)
})
