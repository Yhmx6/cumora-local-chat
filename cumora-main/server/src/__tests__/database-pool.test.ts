import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const { databasePoolMax } = await import('../db/pool.js')

test('DATABASE_POOL_MAX accepts an integer from 1 to 100', () => {
  assert.equal(databasePoolMax(undefined), 20)
  assert.equal(databasePoolMax(''), 20)
  assert.equal(databasePoolMax('40'), 40)
  assert.equal(databasePoolMax('0'), 20)
  assert.equal(databasePoolMax('101'), 20)
  assert.equal(databasePoolMax('nope'), 20)
})

test('readiness does not borrow the request pool, and runtime auth releases it before Redis', async () => {
  const router = await readFile(new URL('../api/router.ts', import.meta.url), 'utf8')
  const health = router.slice(router.indexOf("api.get('/health'"))
  assert.match(health.slice(0, 500), /healthPool\.query\('SELECT 1'\)/)
  assert.doesNotMatch(health.slice(0, 500), /pool\.query\('SELECT 1'\)/)

  const auth = await readFile(new URL('../agents/runtime/authorization.ts', import.meta.url), 'utf8')
  const fn = auth.slice(auth.indexOf('export async function withRuntimeConversationAuthorization'))
  const commit = fn.indexOf("await client.query('COMMIT')")
  const task = fn.indexOf('await args.task()')
  const release = fn.indexOf('client.release()')
  assert.ok(commit >= 0 && release > commit && task > release)
})
