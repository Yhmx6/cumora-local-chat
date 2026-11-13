import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

test('ensureSchema rebuilds required concurrent indexes before the promotion gate', async () => {
  const source = await readFile(new URL('../db/migrate.ts', import.meta.url), 'utf8')
  const ensure = source.slice(source.indexOf('export async function ensureSchema'))
  const verify = ensure.indexOf('await verifyRequiredIndexes(client)')
  const repair = ensure.indexOf('await buildConcurrentIndexes(client)')
  const clientId = ensure.indexOf('await ensureMessageClientIdIndex(client)')
  assert.ok(clientId >= 0 && clientId < verify, 'client-id index repair must run before the gate')
  assert.ok(repair >= 0 && repair < verify, 'concurrent index repair must run before the gate')
})
