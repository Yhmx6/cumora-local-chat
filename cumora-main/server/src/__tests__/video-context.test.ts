import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bilibiliVideoLinks, videoContextBlock, videoMessageReferences } from '../../../shared/video-links.js'
import { isBilibiliMediaHost, readBilibiliVideo } from '../video-context.js'

const url = 'https://www.bilibili.com/video/BV1JrWJ6JERj/'
const ref = bilibiliVideoLinks(url)[0]
test('normalizes tracking links, retains part and deduplicates', () => {
  assert.deepEqual(bilibiliVideoLinks(`${url}?trackid=x&p=2 ${url}?p=2#t=12`), [{ bvid: 'BV1JrWJ6JERj', page: 2, url: url + '?p=2' }])
})
test('rejects spoofed/private/credential URLs and invalid parts', () => {
  for (const input of [url.replace('www.bilibili.com', '127.0.0.1'), url.replace('www.bilibili.com','www.bilibili.com.evil.test'), url.replace('https://','https://user:pass@'), url + '?p=NaN', url + '?p=-1', url.replace('com/', 'com:8443/')]) assert.deepEqual(bilibiliVideoLinks(input), [])
  assert.equal(isBilibiliMediaHost('cdn.bilivideo.com'), true)
  assert.equal(isBilibiliMediaHost('bilivideo.com.evil.test'), false)
  assert.equal(isBilibiliMediaHost('127.0.0.1'), false)
})
test('only visible human messages trigger paid analysis, not agents or system relays', () => {
  const base = { conversation_id: 'g1', body: url, kind: 'text' }
  assert.deepEqual(videoMessageReferences([
    { ...base, id: 'human', author_kind: 'human' },
    { ...base, id: 'bot', author_kind: 'agent' },
    { ...base, id: 'hidden', author_kind: 'human' },
    { ...base, id: 'system', author_kind: 'human', kind: 'system' },
  ], new Set(['human','bot','system'])), [{ messageId: 'human', conversationId: 'g1' }])
})
test('video context is labelled untrusted and does not assert audio/full viewing', () => {
  assert.equal(videoContextBlock(''), '')
  assert.match(videoContextBlock('source'), /UNTRUSTED DATA/)
  assert.match(videoContextBlock('source'), /never claim to have heard audio/)
})
const mock = (options: { noPlay?: boolean; long?: boolean; subtitle?: boolean; visualFail?: boolean } = {}): Parameters<typeof readBilibiliVideo>[1] => ({
  json: async (u: string) => u.includes('/view?') ? { code: 0, data: { title: 'title', desc: 'desc', pages: [{ page: 1, cid: 42, duration: options.long ? 601 : 64 }] } }
    : u.includes('/v2?') ? { code: 0, data: { subtitle: { subtitles: options.subtitle ? [{ lan:'zh-CN', subtitle_url: '//i.hdslb.com/sub.json' }] : [] } } }
    : options.noPlay ? { code: -403 } : { code: 0, data: { durl: [{ url: 'https://cdn.bilivideo.com/video.mp4', size: 100 }] } },
  subtitle: async () => '字幕测试',
  frames: async () => ['frame1','frame2'],
  describe: async () => { if(options.visualFail) throw new Error('timeout'); return '一位蓝发人物站在窗旁。' },
})
test('no subtitles still yields sampled visual evidence with explicit audio limitation', async () => {
  const out = await readBilibiliVideo(ref, mock())
  assert.match(out, /没有可公开读取的字幕/)
  assert.match(out, /画面抽样观察（2帧/)
  assert.match(out, /蓝发人物/)
  assert.match(out, /未收听音轨/)
})
test('subtitle text survives playback or vision failure', async () => {
  for (const variant of [{ noPlay: true }, { visualFail: true }]) {
    const out = await readBilibiliVideo(ref, mock({ ...variant, subtitle: true }))
    assert.match(out, /字幕测试/)
    assert.match(out, /未能读取视频画面/)
    assert.doesNotMatch(out, /画面抽样观察/)
  }
})
test('overlong videos never download or call a model', async () => {
  const deps = mock({ long: true })
  deps.frames = async () => { assert.fail('must not download'); return [] }
  assert.match(await readBilibiliVideo(ref, deps), /超过当前自动画面分析范围/)
})
test('uses official CDN backup when primary is a third-party P2P edge', async () => {
  const deps = mock()
  const original = deps.json
  deps.json = async u => u.includes('/playurl?') ? { code:0, data:{ durl:[{ url:'https://third-party.invalid/v.mp4', backup_url:['https://cdn.bilivideo.com/v.mp4'] }] } } : original(u)
  let used = ''
  deps.frames = async (url?: string) => { used = url ?? ''; return ['frame'] }
  assert.match(await readBilibiliVideo(ref, deps), /画面抽样观察/)
  assert.equal(used, 'https://cdn.bilivideo.com/v.mp4')
})
