import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { buildApiTestApp, ensureSchemaOnce, resetAllTables, seedUserMembership, teardownAll } from './_helpers.js'
import { pool } from '../db/pool.js'
import { getAgentUsageSummary } from '../agents/usage-summary.js'

const company = 'usage-test-workspace', user = 'usage-test-owner'
const now = new Date('2026-11-13T09:00:00Z')
let server: Server, base = ''
before(async () => {
  await ensureSchemaOnce()
  const app = await buildApiTestApp(user)
  await new Promise<void>(resolve => { server = createServer(app).listen(0, () => {
    const addr = server.address(); if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`
    resolve()
  }) })
})
beforeEach(async () => {
  await resetAllTables()
  await pool.query(`INSERT INTO companies (id,name,slug) VALUES ($1,'Usage test',$1),('usage-foreign','Foreign','usage-foreign')`, [company])
  await seedUserMembership(user,company)
  for (const id of ['a','b','c','former']) await pool.query(
    `INSERT INTO participants (id,company_id,kind,name,initial,avatar_bg,status,departed_at)
     VALUES ($1,$2,'agent',$1,'A','#fff','resting', CASE WHEN $1='former' THEN NOW() ELSE NULL END)`, [id,company])
  await pool.query(`INSERT INTO participants (id,company_id,kind,name,initial,avatar_bg,status)
    VALUES ('foreign-a','usage-foreign','agent','Foreign secret name','F','#fff','resting')`)
})
after(async () => { await teardownAll(server) })

async function call(id:string, agent:string|null, options: {measured?:boolean;status?:string;input?:number;cached?:number;writes?:number;output?:number;cost?:number;company?:string;at?:string} = {}) {
  await pool.query(`INSERT INTO llm_calls (id,company_id,agent_id,purpose,model,source,measured,status,input_tokens,cached_input_tokens,cache_creation_tokens,output_tokens,cost_usd,created_at)
    VALUES ($1,$2,$3,'agent-turn','test-model','byoa-codex',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, options.company ?? company, agent, options.measured ?? true, options.status ?? 'ok', options.input ?? 0, options.cached ?? 0, options.writes ?? 0, options.output ?? 0, options.cost ?? 0, options.at ?? now.toISOString()])
}

test('usage sums disjoint token categories, includes measured failures and keeps missing usage distinct', async () => {
  await call('reported','a',{input:10,cached:20,writes:30,output:40,cost:0.2})
  await call('failed-reported','a',{input:1,output:2,cost:0.1,status:'failed'})
  await call('missing','a',{measured:false,input:999,cost:99})
  await call('unknown','b',{measured:false,status:'timeout'})
  await call('former','former',{input:5})
  await call('shared',null,{input:7})
  await call('foreign','foreign-a',{company:'usage-foreign',input:99999})
  const result = await getAgentUsageSummary(company,'today','Asia/Singapore',now)
  const a = result.rows.find(r => r.agentId === 'a')!
  assert.equal(a.name,'a')
  assert.equal(a.totalTokens,103)
  assert.equal(a.calls,3); assert.equal(a.measuredCalls,2); assert.equal(a.unmeasuredCalls,1); assert.equal(a.failedCalls,1)
  assert.ok(Math.abs(a.referenceCostUsd-0.3)<1e-10)
  const b = result.rows.find(r => r.agentId === 'b')!
  assert.equal(b.measuredCalls,0); assert.equal(b.unmeasuredCalls,1)
  assert.equal(result.rows.find(r => r.agentId === 'c')!.calls,0)
  assert.equal(result.rows.find(r => r.agentId === 'former')!.departed,true)
  assert.equal(result.rows.find(r => r.agentId === null)!.inputTokens,7)
  assert.equal(result.totals.totalTokens,115)
  assert.equal(result.totals.calls,6); assert.equal(result.totals.unmeasuredCalls,2)
})

test('calendar ranges respect timezone boundaries, exclude future rows and include all of today', async () => {
  await call('before','a',{input:100,at:'2026-11-12T15:59:59Z'})
  await call('boundary','a',{input:7,at:'2026-11-12T16:00:00Z'})
  await call('future','a',{input:1000,at:'2026-11-13T09:00:01Z'})
  const today = await getAgentUsageSummary(company,'today','Asia/Singapore',now)
  assert.equal(today.from,'2026-11-12T16:00:00.000Z'); assert.equal(today.totals.totalTokens,7)
  assert.equal((await getAgentUsageSummary(company,'week','Asia/Singapore',now)).from,'2026-11-06T16:00:00.000Z')
  assert.equal((await getAgentUsageSummary(company,'month','Asia/Singapore',now)).from,'2026-10-31T16:00:00.000Z')
  assert.equal((await getAgentUsageSummary(company,'week','America/New_York',new Date('2026-11-03T12:00:00Z'))).from,'2026-10-28T04:00:00.000Z')
})

test('usage route requires workspace membership, accepts ordinary members and rejects invalid ranges', async () => {
  await pool.query("UPDATE company_members SET role='member' WHERE company_id=$1 AND user_id=$2",[company,user])
  const get = (query:string,tenant=company) => fetch(`${base}/api/usage/agents${query}`,{headers:{'x-company-id':tenant}})
  const own = await get('?period=today&timezone=Asia%2FSingapore')
  assert.equal(own.status,200)
  const body = await own.json() as { rows:Array<{name:string}> }
  assert.ok(!body.rows.some(r => r.name === 'Foreign secret name'))
  assert.equal((await get('', 'usage-foreign')).status,403)
  assert.equal((await get('?period=forever')).status,400)
  assert.equal((await get('?timezone=invalid')).status,400)
  assert.equal((await get('?timezone=UTC&timezone=Asia%2FSingapore')).status,400)
})
