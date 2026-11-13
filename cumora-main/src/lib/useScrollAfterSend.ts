import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Scroll only for a local send, after the optimistic row and composer resize
 * commit. Cancel pending work when navigating to another conversation. */
export function useScrollAfterSend(scope: string | null, scroll: () => void) {
  const [request, setRequest] = useState(0)
  const pending = useRef<string | null>(null)
  const scrollRef = useRef(scroll)
  useLayoutEffect(() => { scrollRef.current = scroll })
  useEffect(() => {
    const requestedScope = pending.current
    pending.current = null
    if (!scope || requestedScope !== scope) return
    let secondFrame: number | undefined
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => scrollRef.current())
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame)
    }
  }, [request, scope])
  return useCallback(() => {
    if (!scope) return
    pending.current = scope
    setRequest(value => value + 1)
  }, [scope])
}
