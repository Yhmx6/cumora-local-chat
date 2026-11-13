/**
 * AuthGate — wraps the entire app and decides whether to show the
 * sign-in screen or the real UI based on the auth store.
 *
 * Two responsibilities:
 *   1. On first mount, consume a `#token=...&companyId=...` fragment if
 *      one is present (the OAuth callback redirected us back with it).
 *      Persist the session, then scrub the URL so a reload doesn't
 *      re-arm the fragment.
 *   2. Probe /auth/me with the persisted token; if the token is valid
 *      the app loads, otherwise we fall through to AuthScreen.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { isElectron } from '@/lib/runtime'
import { AuthScreen } from './AuthScreen'
import { WindowDragStrip } from './WindowDragStrip'

interface AuthGateProps {
  children: ReactNode
  /** Override the "no token" rendering. The invite-accept flow uses this
   *  so an unauthenticated visitor sees the invitation card (with sign-in
   *  buttons embedded) instead of the bare login screen. */
  unauthFallback?: ReactNode
}

interface CarriedSession { token: string; companyId: string | null }

/** Pull a fresh OAuth token out of `location.hash`. Returns null if the
 *  fragment is empty or has no token. On success, scrubs the fragment so
 *  the token never lingers in the browser address bar. */
function consumeOAuthFragment(): CarriedSession | null {
  const hash = location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const token = params.get('token')
  if (!token) return null
  const companyId = params.get('companyId')
  // Replace the URL without ?#... so refresh/reopen doesn't re-process.
  history.replaceState(null, '', location.pathname + location.search)
  return { token, companyId }
}


export function AuthGate({ children, unauthFallback }: AuthGateProps) {
  const token = useAuth((s) => s.token)
  const ready = useAuth((s) => s.ready)
  const setSession = useAuth((s) => s.setSession)
  const setMe = useAuth((s) => s.setMe)
  const setServerCapabilities = useAuth((s) => s.setServerCapabilities)
  const clear = useAuth((s) => s.clear)
  const markReady = useAuth((s) => s.markReady)
  const localAttempt = useRef<Promise<CarriedSession> | null>(null)
  const [localFailed,setLocalFailed] = useState(false)
  const [localError,setLocalError] = useState('')
  const canEnterLocally = isElectron && !!window.cumora?.desktop?.getLocalSession

  // Run-once: consume the OAuth fragment before the probe effect sees
  // `token` and decides what to do. useState init runs synchronously
  // before any effect, so the auth store has the new token in time.
  useState(() => {
    const carried = consumeOAuthFragment()
    if (carried) {
      // setMe runs on the /auth/me probe right below. For now just plant
      // a placeholder user so setSession's WS-reconnect call has a valid
      // token; the probe will fill in the rest.
      setSession(carried.token, { id: '', email: '', name: '' }, carried.companyId)
    }
    return null
  })

  useEffect(() => {
    let cancelled = false
    if (!token) {
      if (!canEnterLocally || localFailed) { markReady(); return }
      // Reuse across StrictMode effect replay; a token is minted only once.
      localAttempt.current ??= window.cumora!.desktop!.getLocalSession!()
      void localAttempt.current.then(session => {
        if (!cancelled) setSession(session.token,{id:'',email:'',name:''},session.companyId)
      }).catch(e => { if(!cancelled) {setLocalFailed(true);setLocalError(e instanceof Error ? e.message : '本机自动进入失败');markReady()} })
      return () => {cancelled=true}
    }
    void (async () => {
      try {
        const r = await api.authMe()
        if (cancelled) return
        setMe(r.user, r.companies, r.activeCompanyId)
        setServerCapabilities(r.serverCapabilities)
        markReady()
      } catch {
        // Token's bad / expired — clear and route to login.
        if (!cancelled) {
          if(localAttempt.current) {setLocalFailed(true);setLocalError('暂时无法验证本机账号，请重试')}
          clear()
        }
      }
    })()
    return () => { cancelled = true }
  }, [token, setMe, setServerCapabilities, clear, markReady, setSession, canEnterLocally, localFailed])

  // Electron-only: listen for OAuth tokens forwarded by the main
  // process. The user clicked "Continue with Google" → we opened the
  // system browser → provider redirected through our server to
  // http://127.0.0.1:47823/auth/done → loopback page POSTed the
  // parsed fragment to /auth/token → main IPC'd here. Plant the
  // session and trip the /auth/me probe by setting token.
  useEffect(() => {
    if (!isElectron || !window.cumora?.auth) return
    const off = window.cumora.auth.onToken(({ token: t, companyId }) => {
      if (!t) return
      setSession(t, { id: '', email: '', name: '' }, companyId)
    })
    return off
  }, [setSession])

  // Native (iOS / Android): when the SFSafariViewController flow
  // completes, lib/native.ts plants the token fragment on our location
  // and fires `cumora:oauth-token`. Consume it the same way as the
  // top-of-mount `consumeOAuthFragment` so AuthGate's existing probe
  // logic picks up the new token.
  useEffect(() => {
    const handler = () => {
      const carried = consumeOAuthFragment()
      if (!carried) return
      setSession(carried.token, { id: '', email: '', name: '' }, carried.companyId)
    }
    window.addEventListener('cumora:oauth-token', handler)
    return () => window.removeEventListener('cumora:oauth-token', handler)
  }, [setSession])

  if (!ready || (!token && canEnterLocally && !localFailed)) {
    // Brief loading flash while we probe — keeps the app from flashing
    // login → main on a valid token reload.
    return (
      <div
        className="fixed inset-0 grid place-items-center text-ink-300 font-display italic text-[13px]"
        style={{ background: 'var(--paper)' }}
      ><WindowDragStrip />正在进入聊天…</div>
    )
  }

  if (!token) return <>{localError && <div role="alert" className="fixed top-10 left-1/2 z-50 -translate-x-1/2 rounded-md bg-white p-3 text-sm shadow">{localError} <button className="underline" onClick={() => {localAttempt.current=null;setLocalFailed(false);setLocalError('')}}>重试</button></div>}{unauthFallback ?? <AuthScreen />}</>
  return <>{children}</>
}
