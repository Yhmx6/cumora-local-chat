import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, root), 'utf8')
}

function stringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))
  assert.ok(match, `${name} list missing`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

test('api-contract.json names every WsEvent variant in order', () => {
  const source = read('src/api/client.ts')
  const start = source.indexOf('export type WsEvent =')
  const end = source.indexOf('type Listener', start)
  assert.ok(start >= 0 && end > start)
  const eventTypes = [...source.slice(start, end).matchAll(/type: '([^']+)'/g)].map((entry) => entry[1])
  const contract = JSON.parse(read('docs/api-contract.json')) as {
    websocket: { eventTypes: string[] }
  }
  assert.deepEqual(contract.websocket.eventTypes, eventTypes)
})

test('R2 public, signed, and allowed prefixes are one set', () => {
  const worker = read('workers/r2-gate/src/index.ts')
  const storage = read('server/src/storage.ts')
  const keys = read('server/src/storage-keys.ts')
  const publicPrefixes = stringArray(worker, 'PUBLIC_PREFIXES')
  const signedPrefixes = stringArray(storage, 'SIGNED_PREFIXES')
  const allowed = stringArray(keys, 'STORAGE_KEY_PREFIXES')
  assert.deepEqual(publicPrefixes, ['avatars/'])
  assert.deepEqual(
    [...publicPrefixes, ...signedPrefixes].sort(),
    [...allowed].sort(),
  )
  assert.equal(worker.includes('Anything outside this'), false)
})
