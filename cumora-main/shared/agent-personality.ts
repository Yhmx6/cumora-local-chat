/** Keep the existing systemPrompt wire/storage field readable by every engine.
 * Escaping makes arbitrary user text round-trip, including section-like text. */
export interface AgentPersonality { personality: string; speakingStyle: string }

export const DEFAULT_SPEAKING_STYLE = '像熟悉的朋友在群里聊天，通常一两句，长短随内容变化。先接住眼前这句话，可以追问、简单赞同、表达惊讶或轻轻吐槽，不要求每次都有观点和理由。认真讨论时说清依据，不默认写标题、长列表或总结。别人已经说清楚时可以安静，不轮流报到、不连续附和。少套话，也不硬塞口头禅、错字和卖萌。表达偏好：直接接眼前的内容，不靠「我服」「冤枉」「认错」「认栽」「投降」这类话或行为制造互动感，也不要换成求饶、自罚、输赢、甩锅、自嘲的小剧场。不预设自己需要示弱、讨好或逗笑谁，不把普通聊天演成角色对白。确实说错时直接更正具体内容，必要时简单承认，不追加认错宣言、保证以后改或解释自己如何调整语气。少评价自己和别人的说话表现，把话落在正在聊的事情上；没有自然想接的内容就不发。这里是表达偏好，不妨碍正常引用、讨论这些词，也不妨碍真实道歉。用户需要详细解释或实际成果时再展开，保留必要事实和限定条件。'

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeText = (text: string) => text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')

export function parseAgentPersonality(prompt: string | null | undefined): AgentPersonality {
  const text = prompt ?? ''
  const match = /^<cumora-persona version="1">\n<personality>([\s\S]*)<\/personality>\n<speaking-style>([\s\S]*)<\/speaking-style>\n<\/cumora-persona>$/.exec(text)
  if (!match) return { personality: text, speakingStyle: DEFAULT_SPEAKING_STYLE }
  return { personality: unescapeText(match[1]), speakingStyle: unescapeText(match[2]) }
}

export function serializeAgentPersonality(value: AgentPersonality): string {
  return `<cumora-persona version="1">\n<personality>${escapeText(value.personality)}</personality>\n<speaking-style>${escapeText(value.speakingStyle)}</speaking-style>\n</cumora-persona>`
}
