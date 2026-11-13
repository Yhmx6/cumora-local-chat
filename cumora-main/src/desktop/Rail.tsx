import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/stores/app'
import { useAuth, useMe } from '@/stores/auth'
import { useConversations, isMuted } from '@/stores/conversations'
import { useComputers } from '@/stores/computers'
import { useDevtools } from '@/stores/devtools'
import { useParticipants } from '@/stores/participants'
import { Avatar } from '@/components/Avatar'
import { IUsage, IMemory } from '@/components/icons'
import { IChat, IWhisper, IAgent, IAgents, IBoard, IDoc, ICalendar, IObserve, IExit, IShip, IMore } from '@/components/icons'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { useT, type MessageKey } from '@/lib/i18n'
import type { Participant, ViewKey } from '@/types'

// `label` is a message key rather than the string itself — the array is
// module scope, so it can't call a translator that re-renders on a
// locale switch. Resolution happens at render.
const baseItems: Array<{ key: ViewKey['view']; Icon: typeof IChat; label: MessageKey }> = [
  { key: 'conversations', Icon: IChat, label: 'nav.conversations' },
  { key: 'whispers', Icon: IWhisper, label: 'nav.whispers' },
  { key: 'shipping', Icon: IShip, label: 'nav.ship' },
  { key: 'boards', Icon: IBoard, label: 'nav.boards' },
  { key: 'calendar', Icon: ICalendar, label: 'nav.calendar' },
  { key: 'documents', Icon: IDoc, label: 'nav.docs' },
  { key: 'agents', Icon: IAgent, label: 'nav.agents' },
  { key: 'runtime-logs', Icon: IObserve, label: 'nav.runtimeLogs' },
  { key: 'usage', Icon: IUsage, label: 'nav.usage' },
  { key: 'memories', Icon: IMemory, label: 'nav.memories' },
  { key: 'me', Icon: IAgents, label: 'nav.me' },
]

export function Rail() {
  const t = useT()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const dismiss = (event: MouseEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape) }
  }, [moreOpen])
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const devtoolsEnabled = useDevtools((s) => s.enabled)
  const loadDevtools = useDevtools((s) => s.load)
  // Muted conversations are intentionally excluded from this total — that's
  // the whole point of a mute. Their per-row badges still show in the list.
  const totalUnread = useConversations((s) =>
    s.list.reduce((acc, c) => acc + (isMuted(c) ? 0 : (c.unread ?? 0)), 0),
  )
  // Any paired computer running an outdated daemon → a gold dot on the avatar
  // so the upgrade nudge is visible app-wide, not just inside the You view.
  const daemonOutdated = useComputers((s) => Object.values(s.byId).some((c) => c.daemonOutdated))
  useEffect(() => {
    void loadDevtools()
  }, [loadDevtools])
  // Whispers is the OWNER-ONLY agent-chat observer view (server gates
  // /peek/agent-chats to the company owner). Hide the rail item for non-owners
  // so they never click into a 403/empty view.
  const isOwner = useAuth((s) => s.companies.find((c) => c.id === s.activeCompanyId)?.role === 'owner')
  const assembled = devtoolsEnabled
    ? [
        ...baseItems.slice(0, 3),
        { key: 'observability' as const, Icon: IObserve, label: 'nav.observe' as MessageKey },
        ...baseItems.slice(3),
      ]
    : baseItems
  const items = isOwner ? assembled : assembled.filter((i) => i.key !== 'whispers')
  // The Rail's top avatar is the SIGNED-IN user, not a mock. Resolve the
  // current user's participant record so the Gravatar (set during signup
  // / backfilled at boot) shows up properly. Fall back to a minimal
  // ad-hoc Participant when the store hasn't loaded yet — avoids any
  // flash of "Y on coral" placeholder for the real user.
  const meId = useMe()
  const authUser = useAuth((s) => s.user)
  const byId = useParticipants((s) => s.byId)
  const meParticipant: Participant | null = (meId && byId[meId]) ? byId[meId] : null
  const fallback: Participant = {
    id: authUser?.id ?? 'me',
    kind: 'human',
    name: authUser?.name ?? t('common.you'),
    initial: (authUser?.name ?? 'Y').charAt(0).toUpperCase(),
    avatarBg: 'linear-gradient(135deg, #FF7A6B, #F4B740)',
    status: 'avail',
  } as Participant
  const meAvatar = meParticipant ?? fallback

  const primaryKeys = ['conversations', 'agents', 'memories', 'documents', 'usage', 'runtime-logs']
  const primary = primaryKeys.flatMap(key => items.filter(item => item.key === key))
  const secondary = items.filter(item => !primaryKeys.includes(item.key) && item.key !== 'me')
  const navigationButton = ({ key, Icon, label }: typeof baseItems[number]) => (
    <button type="button" key={key} onClick={() => { setView(key); setMoreOpen(false) }}
      title={t(label)} aria-label={t(label)} aria-current={view === key ? 'page' : undefined}
      className={cn('messenger-rail-button', view === key && 'is-active')}>
      <Icon className="w-6 h-6" />
      {key === 'conversations' && totalUnread > 0 && <span className="messenger-unread">{totalUnread > 99 ? '99+' : totalUnread}</span>}
    </button>
  )
  return (
    <aside className="messenger-rail">
      <button type="button" className="messenger-user-avatar relative" onClick={() => setView('me')}
        title={daemonOutdated ? t('common.daemonOutdatedTip') : (authUser?.name ?? t('common.you'))}>
        <Avatar p={meAvatar} size={36} showStatus={false} />
        {daemonOutdated && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-gold" />}
      </button>
      {primary.map(navigationButton)}
      <div className="flex-1" />
      {navigationButton({ key: 'me', Icon: IAgents, label: 'nav.me' })}
      <div ref={moreRef} className="relative">
        <button type="button" className={cn('messenger-rail-button', (moreOpen || secondary.some(item => item.key === view)) && 'is-active')}
          onClick={() => setMoreOpen(value => !value)} aria-label={t('nav.more')} title={t('nav.more')}
          aria-expanded={moreOpen} aria-controls="messenger-more">
          <IMore className="w-6 h-6" />
        </button>
        {moreOpen && <nav id="messenger-more" aria-label={t('nav.more')} className="messenger-more-menu">
          {secondary.map(({ key, Icon, label }) => <button type="button" key={key}
            aria-current={view === key ? 'page' : undefined}
            onClick={() => { setView(key); setMoreOpen(false) }}>
            <Icon className="w-[18px] h-[18px]" /><span>{t(label)}</span>
          </button>)}
          <div className="my-1 border-t border-ink-100" />
          <button type="button" onClick={async () => {
            try { await api.authLogout() } catch (e) { console.warn('[signout] server call failed', e) }
            useAuth.getState().clear()
            location.reload()
          }}><IExit className="w-[18px] h-[18px]" /><span>{t('common.signOut')}</span></button>
        </nav>}
      </div>
    </aside>
  )
}
