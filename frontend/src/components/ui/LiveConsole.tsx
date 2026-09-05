import { useEffect, useRef } from 'react'
import { font } from '../../theme'

export interface LogEntry {
  id: number
  time: string
  tag: string
  message: string
}

// Tails real, derived events — status transitions from diffing consecutive
// backend snapshots, plus the literal actions this UI sends (fault
// injections, scale/reset requests, connection lifecycle). Nothing here is
// synthesized to look like activity; every line traces back to an actual
// state change or an actual send() call (see useSimulationSocket and
// App()'s trigger* functions). `filterTag` scopes the view to `system`
// lines plus whichever server is currently selected, so switching the
// selected tile switches what's being tailed.
interface LiveConsoleProps {
  logs: LogEntry[]
  filterTag: string | null
}

export function LiveConsole({ logs, filterTag }: LiveConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const visible = logs.filter(l => l.tag === 'system' || l.tag === filterTag)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [visible.length])

  return (
    <div ref={scrollRef} style={{
      height: '100%', overflowY: 'auto', boxSizing: 'border-box',
      fontFamily: font.mono, fontSize: '11px',
      padding: '8px 16px', lineHeight: '1.7',
    }}>
      {visible.length === 0 && <div style={{ color: '#475569' }}>No events yet.</div>}
      {visible.map(l => (
        <div key={l.id} style={{ whiteSpace: 'pre', color: '#cbd5e1' }}>
          <span style={{ color: '#475569' }}>{l.time}</span>{'  '}
          <span style={{ color: l.tag === 'system' ? '#38bdf8' : '#a78bfa', fontWeight: 'bold' }}>{l.tag.padEnd(10)}</span>
          {l.message}
        </div>
      ))}
    </div>
  )
}
