export type SocialMemoryKind = 'preference' | 'event' | 'opinion'
export interface SocialMemory {
  id: string; body: string; kind: SocialMemoryKind; conversationId: string | null
  conversationTitle: string | null; sourceMessageId: string | null; sourceExcerpt: string | null
  origin: 'agent' | 'human'; revision: number; createdAt: string; updatedAt: string
}
export interface SocialMemoryList { enabled: boolean; memories: SocialMemory[] }
