import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discussionWindows } from '../agents/discussion-window.js'
import { buildTriageRequest } from '../agents/triage-core.js'
import type { ContextRow, PersonaRow } from '../agents/runtime/client.js'

const persona: PersonaRow = { id: 'a', name: 'A', role: '', style: '', model: null, companyId: 'co' }
function row(sequence: number, author: string, kind: 'human' | 'agent' = 'agent'): ContextRow {
  return {
    id: `m${sequence}`, sequence, author_id: author, author_kind: kind, author_name: author,
    conversation_id: 'g', conversation_kind: 'group', conversation_title: 'Discussion', conversation_topic: null,
    company_id: 'co', body: 'A concrete point', kind: 'text', created_at: new Date().toISOString(),
    attachment: null, quoted_message_id: null, quoted: null, is_unread: true, is_self: author === 'a',
    project_name: null, reactions: [],
  }
}

test('a human-started discussion permits peer rebuttals beyond the old one-round cap', () => {
  const context = [row(1, 'h', 'human'), row(2, 'a'), row(3, 'b'), row(4, 'a'), row(5, 'b')]
  const request = buildTriageRequest({ agentId: 'a', persona, inbox: [context[4]], context })
  assert.equal(request.verdict, undefined)
  assert.match(request.instructions!, /HUMAN-STARTED DISCUSSION exception/)
  assert.equal(request.failClosed, true)
})

test('three contributions stop the next agent-only wake even with read receipts and supervision', () => {
  const context = [row(1, 'h', 'human'), row(2, 'a'), row(3, 'b'), row(4, 'a'), row(5, 'b'), row(6, 'a'), row(7, 'b')]
  for (const message of context) message.human_last_read_at = new Date().toISOString()
  const request = buildTriageRequest({ agentId: 'a', persona, inbox: [context[6]], context, humanActiveInCompany: true })
  assert.equal(request.verdict?.source, 'loop-cap')
  context.push(row(8, 'h', 'human'))
  assert.equal(buildTriageRequest({ agentId: 'a', persona, inbox: [context[7]], context }).verdict?.actionable, true)
  assert.equal(discussionWindows(context, 'a').get('g')?.ownCount, 0)
})

test('old topics, agent-only rooms, other rooms and system notices do not open a discussion window', () => {
  const human = row(1, 'h', 'human')
  human.created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString()
  assert.equal(discussionWindows([human, row(2, 'b')], 'a').get('g')?.active, false)
  assert.equal(discussionWindows([row(1, 'b')], 'a').size, 0)
  assert.equal(discussionWindows([{ ...human, kind: 'system' }], 'a').size, 0)
  const windows = discussionWindows([row(1, 'h', 'human'), { ...row(2, 'a'), conversation_id: 'other' }], 'a')
  assert.equal(windows.get('g')?.ownCount, 0)
  assert.equal(windows.has('other'), false)
})

test('an expired group discussion stays closed even while the human reads the room', () => {
  const human = row(1, 'h', 'human')
  human.created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString()
  const peer = row(2, 'b')
  peer.human_last_read_at = new Date().toISOString()
  peer.human_reacted_at = new Date().toISOString()
  const request = buildTriageRequest({ agentId: 'a', persona, inbox: [peer], context: [human, peer], humanActiveInCompany: true })
  assert.equal(request.verdict?.actionable, false)
  assert.equal(request.verdict?.source, 'loop-cap')
  const nextHuman = row(3, 'h', 'human')
  assert.equal(buildTriageRequest({ agentId: 'a', persona, inbox: [nextHuman], context: [human, peer, nextHuman] }).verdict?.actionable, true)
})
