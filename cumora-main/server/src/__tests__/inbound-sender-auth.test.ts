/**
 * Pure gate in front of resolveSender. A spoofed From used to become the
 * workspace member with that address. Internal attribution now requires the
 * gate's aligned verdict and an envelope sender that is the same mailbox.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const { inboundSenderAuthenticated } = await import('../api/inbound-email.js')

test('a missing or non-aligned verdict never maps onto an internal author', () => {
  assert.equal(inboundSenderAuthenticated({
    authVerdict: undefined,
    envelopeFrom: 'ceo@victim.test',
    headerFrom: 'CEO <ceo@victim.test>',
  }), false)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'unaligned',
    envelopeFrom: 'ceo@victim.test',
    headerFrom: 'ceo@victim.test',
  }), false)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned ',
    envelopeFrom: 'ceo@victim.test',
    headerFrom: 'ceo@victim.test',
  }), false)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned',
    envelopeFrom: undefined,
    headerFrom: 'ceo@victim.test',
  }), false)
})

test('an aligned verdict maps only when the envelope mailbox is the header From', () => {
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned',
    envelopeFrom: 'ceo@victim.test',
    headerFrom: 'CEO <ceo@victim.test>',
  }), true)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned',
    envelopeFrom: 'CEO <CEO@victim.test>',
    headerFrom: 'ceo@victim.test',
  }), true)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned',
    envelopeFrom: 'bounces@victim.test',
    headerFrom: 'CEO <ceo@victim.test>',
  }), false)
  assert.equal(inboundSenderAuthenticated({
    authVerdict: 'aligned',
    envelopeFrom: 'not-an-address',
    headerFrom: 'ceo@victim.test',
  }), false)
})
