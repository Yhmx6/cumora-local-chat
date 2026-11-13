/**
 * Chat bubble layout — per-device, like appearance and locale.
 *
 * Default is `bubble`: your messages on the right, teammates on the left.
 * `thread` remains an explicit opt-in. Not synced through server
 * preferences: two devices can disagree.
 */
import { create } from 'zustand'

export type ChatLayout = 'thread' | 'bubble'

const STORAGE_KEY = 'cumora.chatLayout'

function isChatLayout(v: string | null): v is ChatLayout {
  return v === 'thread' || v === 'bubble'
}

function readInitial(): ChatLayout {
  if (typeof window === 'undefined') return 'bubble'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isChatLayout(raw)) return raw
  } catch {
    /* private mode */
  }
  return 'bubble'
}

interface ChatLayoutState {
  layout: ChatLayout
  setLayout(next: ChatLayout): void
}

export const useChatLayoutStore = create<ChatLayoutState>((set) => ({
  layout: readInitial(),
  setLayout(next) {
    set({ layout: next })
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  },
}))
