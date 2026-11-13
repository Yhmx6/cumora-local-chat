/**
 * The idle tick used to run on every replica. Two Pods meant two classifier
 * calls and two agent turns per tenant. The tick now holds one advisory lock
 * and refuses to overlap itself.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const { runIdleTick, startIdleScheduler } = await import('../agents/idle.js')
const { pool } = await import('../db/pool.js')

test('a replica that does not get the idle lock does no tenant work', async () => {
  const originalConnect = pool.connect
  const originalQuery = pool.query.bind(pool)
  let companyQueries = 0
  let unlocked = false
  pool.connect = (async () => ({
    async query(sql: string) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: false }] }
      if (sql.includes('pg_advisory_unlock')) {
        unlocked = true
        return { rows: [] }
      }
      throw new Error(`unexpected client query: ${sql}`)
    },
    release() {},
  })) as unknown as typeof pool.connect
  pool.query = (async (sql: string) => {
    if (String(sql).includes('FROM companies')) companyQueries += 1
    return { rows: [] }
  }) as unknown as typeof pool.query
  try {
    await runIdleTick()
  } finally {
    pool.connect = originalConnect
    pool.query = originalQuery as typeof pool.query
  }
  assert.equal(companyQueries, 0)
  assert.equal(unlocked, false)
})

test('the lock holder walks companies in id order and then unlocks', async () => {
  const originalConnect = pool.connect
  const originalQuery = pool.query.bind(pool)
  const clientSql: string[] = []
  let companySql = ''
  pool.connect = (async () => ({
    async query(sql: string) {
      clientSql.push(sql)
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: true }] }
      return { rows: [] }
    },
    release() {},
  })) as unknown as typeof pool.connect
  pool.query = (async (sql: string) => {
    companySql = String(sql)
    return { rows: [] }
  }) as unknown as typeof pool.query
  try {
    await runIdleTick()
  } finally {
    pool.connect = originalConnect
    pool.query = originalQuery as typeof pool.query
  }
  assert.match(companySql, /ORDER BY id/)
  assert.equal(clientSql.filter((sql) => sql.includes('pg_advisory_unlock')).length, 1)
})

test('startIdleScheduler refuses a non-positive interval', () => {
  assert.equal(startIdleScheduler(0), null)
  assert.equal(startIdleScheduler(-1), null)
})
