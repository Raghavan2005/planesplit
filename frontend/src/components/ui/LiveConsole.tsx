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
//
// This panel deliberately has NO internal scrollbar. A real "tail -f"
// console only ever shows its most recent lines anyway — scrolling back
// through 300 buffered events would just be a worse version of reading the
// full log elsewhere. So instead of overflow+auto-scroll-to-bottom, it
// renders only the newest MAX_VISIBLE_LINES entries that are guaranteed to
// fit the fixed-height bottom console row at 1536x864, and nothing more:
// the same real events, just always showing the tail without a scrollbar
// to operate.
const MAX_VISIBLE_LINES = 7

interface LiveConsoleProps {
  logs: LogEntry[]
  filterTag: string | null
}

export function LiveConsole({ logs, filterTag }: LiveConsoleProps) {
  const visible = logs.filter(l => l.tag === 'system' || l.tag === filterTag).slice(-MAX_VISIBLE_LINES)

  return (
    <div style={{
      height: '100%', overflow: 'hidden', boxSizing: 'border-box',
      fontFamily: font.mono, fontSize: '11px',
      padding: '6px 16px', lineHeight: '1.55',
    }}>
      {visible.length === 0 && <div style={{ color: '#475569' }}>No events yet.</div>}
      {visible.map(l => (
        <div key={l.id} style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', color: '#cbd5e1' }}>
          <span style={{ color: '#475569' }}>{l.time}</span>{'  '}
          <span style={{ color: l.tag === 'system' ? '#38bdf8' : '#a78bfa', fontWeight: 'bold' }}>{l.tag.padEnd(10)}</span>
          {l.message}
        </div>
      ))}
    </div>
  )
}
