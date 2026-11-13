import {RuntimeLogsView} from './RuntimeLogsView'
import { lazy, Suspense, useEffect } from 'react'
import { useApp } from '@/stores/app'
import { useDevtools } from '@/stores/devtools'
import { isElectron } from '@/lib/runtime'
import { useResizableWidth } from '@/lib/useResizableWidth'
import { TitleBar } from './TitleBar'
import { Rail } from './Rail'
import { ConversationsPane } from './ConversationsPane'
import { ChatPane } from './ChatPane'
import { InfoPane } from './InfoPane'
import { ThreadDrawer } from './ThreadDrawer'
import { DocumentPeekPane } from './DocumentPeekPane'
import { BoardPeekPane } from './BoardPeekPane'
import { CalendarPeekPane } from './CalendarPeekPane'
import { WhispersView } from './WhispersView'
import { ConveneView } from './ConveneView'
import { AgentsView } from './AgentsView'
import { BoardsView } from './BoardsView'
import { CalendarView } from './CalendarView'
import { DocumentsView } from './DocumentsView'
import { ObservabilityView } from './ObservabilityView'
import { MeView } from './MeView'
import { UsageView } from './UsageView'
import { MemoriesView } from './MemoriesView'
import { EmailComposer } from '@/components/EmailComposer'
import { useT } from '@/lib/i18n'
import '@/styles/messenger.css'

const ShippingView = lazy(() => import('./ShippingView').then((module) => ({ default: module.ShippingView })))

function ConversationsLayout() {
  const infoOpen = useApp((s) => s.infoAgentId !== null)
  const threadOpen = useApp((s) => s.openThread !== null)
  const documentOpen = useApp((s) => s.openDocumentId !== null)
  const boardOpen = useApp((s) => s.openBoardId !== null)
  const calendarOpen = useApp((s) => s.openCalendarEventId !== null)
  // Thread + info + artifact peeks compete for the same right slot. Opening one closes the
  // other implicitly via the store action (see openThreadView /
  // openAgentInfo / artifact peek actions). Render thread if both somehow
  // ended up set, since the thread is the more action-oriented pane.
  const artifactOpen = documentOpen || boardOpen || calendarOpen
  const rightOpen = threadOpen || infoOpen || artifactOpen
  const rightColumn = documentOpen || boardOpen ? 'clamp(420px, 42vw, 640px)' : '420px'
  const { width, onResizeStart } = useResizableWidth('sidebar:conversations', 280, { min: 240, max: 420 })
  return (
    <div
      className="messenger-layout grid h-full overflow-hidden"
      style={{ gridTemplateColumns: rightOpen ? `${width}px minmax(0, 1fr) ${rightColumn}` : `${width}px minmax(0, 1fr)` }}
    >
      <ConversationsPane onResizeStart={onResizeStart} />
      <ChatPane />
      {threadOpen
        ? <ThreadDrawer />
        : documentOpen
          ? <DocumentPeekPane />
          : boardOpen
            ? <BoardPeekPane />
            : calendarOpen
              ? <CalendarPeekPane />
              : infoOpen
                ? <InfoPane />
                : null}
    </div>
  )
}

export function DesktopApp() {
  const t = useT()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const devtoolsEnabled = useDevtools((s) => s.enabled)
  const devtoolsLoaded = useDevtools((s) => s.loaded)
  const loadDevtools = useDevtools((s) => s.load)

  useEffect(() => {
    void loadDevtools()
  }, [loadDevtools])

  useEffect(() => {
    if (view === 'observability' && devtoolsLoaded && !devtoolsEnabled) setView('conversations')
  }, [devtoolsEnabled, devtoolsLoaded, setView, view])

  return (
    <div className="desktop-messenger relative bg-cloud overflow-hidden grid" data-native={isElectron || undefined}>
      <TitleBar />
      <div className="grid h-full min-h-0 overflow-hidden" style={{ gridTemplateColumns: '64px minmax(0, 1fr)' }}>
        <Rail />
        {view === 'conversations' && <ConversationsLayout />}
        {view === 'whispers' && <WhispersView />}
        {view === 'convene' && <ConveneView />}
        {view === 'agents' && <AgentsView />}
        {view === 'boards' && <BoardsView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'documents' && <DocumentsView />}
        {view === 'shipping' && <Suspense fallback={<div className="h-full grid place-items-center text-sm text-ink-400">{t('desktop.openingShip')}</div>}><ShippingView /></Suspense>}
        {view === 'observability' && devtoolsEnabled && <ObservabilityView />}
        {view === 'me' && <MeView />}
        {view === 'usage' && <UsageView />}
        {view === 'runtime-logs' && <RuntimeLogsView />}
        {view === 'memories' && <MemoriesView />}
      </div>
      {/* Email composer drawer — globally rendered so opening it works
          from any view (sidebar Compose CTA, EmailCard reply button). */}
      <EmailComposer />
    </div>
  )
}
