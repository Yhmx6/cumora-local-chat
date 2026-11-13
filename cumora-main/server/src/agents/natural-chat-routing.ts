/** Local chat pacing, not a semantic classifier. Explicit room invitations
 * wake everyone; ordinary messages elect a first reader. All members keep
 * their inboxes and are woken by the first reply, so this never hides content. */
export function invitesWholeRoom(body: string): boolean {
  return /(?<![\w@])@(?:all|everyone)(?![\w-])/i.test(body)
    || /(?:大家|你们|各位|全员|所有人|每个人|每位|每个\s*(?:AI|模型)).{0,16}(?:都|各自|分别|轮流|依次|逐一|说说|发言|意见|回答|讨论|投票)/i.test(body)
    || /(?:各抒己见|都说说|一起(?:讨论|聊聊|说说)|轮流(?:回答|发言))/.test(body)
    || /\b(?:everyone|everybody|each of you|all of you)\b/i.test(body)
}

/** Bare names only count as an address at the START of a message. Mentions
 * elsewhere may simply discuss a peer. Duplicate display names stay plural. */
export function namedChatTargets(body: string, candidates: ReadonlyArray<{ id: string; name: string }>): string[] {
  const text = body.trimStart().toLocaleLowerCase()
  return candidates.filter(({ name }) => {
    const label = name.trim().toLocaleLowerCase()
    if (!label || !text.startsWith(label)) return false
    const tail = text.slice(label.length)
    return tail === '' || /^(?:[\s,，:：、!?！？]|你|帮|请|先|来|能不能|能否|觉得)/.test(tail)
  }).map(({ id }) => id)
}

export type NaturalChatRoute = { mode: 'each' | 'me' | 'one-of-us'; targets: string[] }

export function naturalChatRoute(body: string, candidates: readonly string[], targets: readonly string[]): NaturalChatRoute {
  if (candidates.length < 2 || invitesWholeRoom(body)) return { mode: 'each', targets: [...candidates] }
  const addressed = [...new Set(targets.filter((id) => candidates.includes(id)))]
  if (addressed.length) return { mode: 'me', targets: addressed }
  return { mode: 'one-of-us', targets: [] }
}

/** A stable per-message rotation avoids making the alphabetically first bot
 * the permanent host. Availability still takes priority in electLineup. */
export function chatRotation(seed: string, ids: readonly string[]): string[] {
  const sorted = [...new Set(ids)].sort()
  if (!sorted.length) return []
  let hash = 2166136261
  for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0
  const offset = hash % sorted.length
  return [...sorted.slice(offset), ...sorted.slice(0, offset)]
}
