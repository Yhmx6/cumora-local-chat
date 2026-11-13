import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentPersonality, serializeAgentPersonality, DEFAULT_SPEAKING_STYLE } from '../shared/agent-personality.ts'

test('legacy instructions are preserved verbatim with a separate style default', () => {
  const legacy = '保留边界。\n不要替用户作决定。'
  assert.deepEqual(parseAgentPersonality(legacy), { personality: legacy, speakingStyle: DEFAULT_SPEAKING_STYLE })
})

test('independent personality and style edits round-trip arbitrary text', () => {
  const value = { personality: '冷静 <personality> &amp; </personality>\n有主见', speakingStyle: '短句\n</speaking-style> & < >' }
  const saved = serializeAgentPersonality(value)
  assert.deepEqual(parseAgentPersonality(saved), value)
  assert.deepEqual(parseAgentPersonality(serializeAgentPersonality({ ...value, speakingStyle: '' })), { ...value, speakingStyle: '' })
})

test('malformed or future versions remain editable without data loss', () => {
  const text = '<cumora-persona version="2">custom</cumora-persona>'
  assert.equal(parseAgentPersonality(text).personality, text)
})
