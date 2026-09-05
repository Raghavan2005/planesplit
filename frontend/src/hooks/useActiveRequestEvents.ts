import { useEffect, useRef, useState } from 'react'
import type { RequestEvent } from './useSimulationSocket'

// A `request_event` (real, user-triggered -- see backend/state.py::
// SimulationState.send_request) needs a discrete, one-shot travel
// animation distinct from the perpetual ambient traffic every flow already
// renders. useSimulationSocket's `requestEvents` is a persistent, deduped
// history (up to 50 entries, survives reconnects via `recent_requests`) --
// it is NOT "currently animating"; most of it is history a user scrolled
// past long ago. This hook derives the actual animation-worthy subset:
// events this client has not rendered before, kept alive only long enough
// to travel their path and show their outcome, then dropped from the
// visual layer entirely (the permanent record lives in AnalysisPanel's
// request history table, not here).
export interface ActiveRequestEvent {
  event: RequestEvent
  // performance.now() timestamp when THIS client first observed the event
  // -- not `event.sent_at` (a backend wall-clock time in a different
  // epoch/clock than the browser's performance.now()), so every consumer
  // computes animation progress against the same local clock.
  firstSeenAt: number
}

// How long a marker stays in the active/visible set after first appearing:
// long enough to travel its path (see TRAVEL_DURATION_MS in the renderers)
// and leave its delivered/diverged/dropped indicator on screen for a beat
// before disappearing.
const ACTIVE_WINDOW_MS = 4000
const SWEEP_INTERVAL_MS = 250

export function useActiveRequestEvents(requestEvents: RequestEvent[]): ActiveRequestEvent[] {
  const [active, setActive] = useState<ActiveRequestEvent[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Promote newly-seen events into the active set exactly once each --
  // requestEvents itself never shrinks (it's a capped history), so without
  // seenIdsRef every render would re-animate every event ever received.
  useEffect(() => {
    const fresh = requestEvents.filter((e) => !seenIdsRef.current.has(e.id))
    if (fresh.length === 0) return
    const now = performance.now()
    fresh.forEach((e) => seenIdsRef.current.add(e.id))
    setActive((prev) => [...prev, ...fresh.map((event) => ({ event, firstSeenAt: now }))])
  }, [requestEvents])

  // Sweep out anything past its active window on a light interval, rather
  // than one setTimeout per event -- simpler cleanup with a bounded number
  // of timers regardless of how many requests get sent in a burst.
  useEffect(() => {
    if (active.length === 0) return
    const timer = setInterval(() => {
      const now = performance.now()
      setActive((prev) => prev.filter((a) => now - a.firstSeenAt < ACTIVE_WINDOW_MS))
    }, SWEEP_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active.length])

  return active
}
