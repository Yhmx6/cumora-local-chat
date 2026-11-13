import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatRotation, invitesWholeRoom, namedChatTargets, naturalChatRoute } from '../agents/natural-chat-routing.js'
import { electLineup } from '../agents/routing-election.js'

const roster = [{ id: 'a', name: '豆包' }, { id: 'b', name: 'Kimi' }, { id: 'c', name: 'Claude' }]
const ids = roster.map((r) => r.id)

test('ordinary chat elects one reader while explicit room invitations keep everyone', () => {
  for (const text of ['今天有点累', '你们觉得这个怎么样', '我想加个语音功能']) {
    assert.equal(naturalChatRoute(text, ids, []).mode, 'one-of-us')
  }
  for (const text of ['大家都说说', '每个AI分别回答一下', '大家一起讨论这个', '@all 有空吗', '@everyone hi', 'everyone answer once']) {
    assert.equal(invitesWholeRoom(text), true, text)
    assert.deepEqual(naturalChatRoute(text, ids, ['a']), { mode: 'each', targets: ids })
  }
})

test('named addresses and quoted targets narrow only to eligible members', () => {
  assert.deepEqual(namedChatTargets('豆包，你怎么看', roster), ['a'])
  assert.deepEqual(namedChatTargets('kimi 帮我看看', roster), ['b'])
  assert.deepEqual(namedChatTargets('我觉得豆包说得对', roster), [])
  assert.deepEqual(namedChatTargets('ClaudeCode 怎么安装', roster), [])
  assert.deepEqual(naturalChatRoute('你刚才说的是什么意思', ids, ['b', 'b', 'departed']), { mode: 'me', targets: ['b'] })
  assert.equal(naturalChatRoute('看看这个', ids, ['departed']).mode, 'one-of-us')
  assert.deepEqual(naturalChatRoute('hi', ['a'], []), { mode: 'each', targets: ['a'] })
})

test('duplicate names do not arbitrarily hide one member', () => {
  assert.deepEqual(namedChatTargets('豆包，你说呢', [...roster, { id: 'd', name: '豆包' }]), ['a', 'd'])
})

test('rotation is stable across replicas and varies first readers across messages', () => {
  assert.deepEqual(chatRotation('m1', ids), chatRotation('m1', [...ids].reverse()))
  const first = new Set(Array.from({ length: 30 }, (_, i) => chatRotation(`m${i}`, ids)[0]))
  assert.equal(first.size, ids.length)
  assert.deepEqual(chatRotation('m1', []), [])
})

test('recent addressee wins when available; busy candidate cannot displace an available one', () => {
  const candidates = ids.map((id) => ({ id, role: null, status: 'avail', statusUpdatedAt: new Date(1000) }))
  assert.equal(electLineup('b', candidates, { rotationSeed: 'm1' })?.primary, 'b')
  candidates[1].status = 'thinking'
  const result = electLineup('b', candidates, { rotationSeed: 'm1', now: 1100, leaseMs: 5000 })!
  assert.notEqual(result.primary, 'b')
  assert.equal(result.lineup.at(-1), 'b')
  assert.equal(new Set(result.lineup).size, 3)
})
