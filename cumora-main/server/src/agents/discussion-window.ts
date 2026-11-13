import type { ContextRow } from './runtime/client.js'

export const DISCUSSION_MAX_CONTRIBUTIONS = 3
const DISCUSSION_WINDOW_MS = 10 * 60 * 1000

/** A short human-started exchange can include rebuttals without a work claim.
 * Only a new human message resets the budget, not read receipts or AI mentions. */
export function discussionWindows(context: ContextRow[], agentId: string, now = Date.now()) {
  const groups = new Map<string, ContextRow[]>()
  for (const row of context) {
    if (row.conversation_kind !== 'group' || row.kind === 'system') continue
    const rows = groups.get(row.conversation_id) ?? []
    rows.push(row)
    groups.set(row.conversation_id, rows)
  }
  const result = new Map<string, { active: boolean; exhausted: boolean; ownCount: number }>()
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.sequence - b.sequence)
    const human = rows.filter((row) => row.author_kind === 'human').at(-1)
    if (!human) continue
    const age = now - Date.parse(human.created_at)
    const ownCount = rows.filter((row) => row.sequence > human.sequence && row.author_id === agentId && row.author_kind === 'agent').length
    result.set(id, {
      active: age >= 0 && age <= DISCUSSION_WINDOW_MS,
      exhausted: ownCount >= DISCUSSION_MAX_CONTRIBUTIONS,
      ownCount,
    })
  }
  return result
}
