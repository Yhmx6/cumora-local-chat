import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const { compareOutboxRows } = await import('../realtime-outbox.js')

test('outbox delivery keeps created_at order inside a claimed batch', () => {
  const rows = [
    { id: 'b', createdAt: '2026-10-03T00:00:02.000Z' },
    { id: 'a', createdAt: '2026-10-03T00:00:01.000Z' },
    { id: 'c', createdAt: '2026-10-03T00:00:02.000Z' },
  ]
  assert.deepEqual([...rows].sort(compareOutboxRows).map((row) => row.id), ['a', 'b', 'c'])
})

test('durable message wakes are enqueued in the same transaction as the insert', async () => {
  const mention = await readFile(new URL('../ws.ts', import.meta.url), 'utf8')
  const wake = mention.slice(mention.indexOf('async function postDocMentionWake'))
  const wakeCommit = wake.indexOf("await client.query('COMMIT')")
  assert.ok(wake.indexOf('enqueueBroadcast(client, CH_MESSAGE_NEW') < wakeCommit)

  const pull = await readFile(new URL('../agents/scanner_helper.ts', import.meta.url), 'utf8')
  const pullCommit = pull.indexOf("await client.query('COMMIT')")
  assert.ok(pull.indexOf('enqueueBroadcast(client, CH_MESSAGE_NEW') < pullCommit)
  assert.ok(pull.indexOf('enqueueBroadcast(client, CH_GROUP_PULLED') < pullCommit)
  assert.doesNotMatch(pull, /publish\(CH_MESSAGE_NEW/)
})
