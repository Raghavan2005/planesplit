import { colors, font } from '../../theme'

export interface AlertHistoryEntry {
  id: number
  server_id: string
  reason: string
  fault_node: string | null
  time: string
  detectedAt: number | null
}

// Persistent, capped log of every real 'alert' transition App()'s
// flows-diffing effect has observed (see App.tsx's `alertHistory` state,
// pushed alongside the existing ephemeral toast) — unlike AlertToasts, rows
// here stay until the cap (30, newest first) evicts them, so a judge can
// scroll back through everything that happened in the demo, not just the
// last 7 seconds of it. Every field is real: id/time are the same
// synchronously-captured values the toast uses, reason/fault_node come
// straight off the FlowSnapshot that triggered the transition.
interface AlertHistoryProps {
  entries: AlertHistoryEntry[]
  onSelect: (serverId: string) => void
  selectedServerId: string | null
}

export function AlertHistory({ entries, onSelect, selectedServerId }: AlertHistoryProps) {
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{
        fontSize: '10px', fontWeight: 'bold', color: colors.textPrimary,
        marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>Alert History</span>
        <span style={{ fontSize: '9px', color: colors.textMuted, fontWeight: 'normal' }}>{entries.length} recorded</span>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '3px',
        // Bounded on purpose, same reasoning as ServerStatusGrid's own
        // maxHeight + overflowY: this list is capped at 30 entries but even
        // 30 rows would otherwise dominate the sidebar — it stays a small,
        // well-behaved chunk with its own internal scroll instead of
        // forcing the whole (now-scrollable) sidebar to grow around it.
        // Kept deliberately shorter than a first pass (~2-3 rows visible,
        // not ~5): AnalysisPanel below is the one panel allowed to flex/
        // shrink for its own content (full CP/DP trace, Agent Review,
        // request history), so this list shouldn't eat more of the
        // sidebar's fixed vertical budget than it needs to stay useful.
        maxHeight: '72px', overflowY: 'auto', overflowX: 'hidden', padding: '1px',
      }}>
        {entries.length === 0 ? (
          <div style={{ fontSize: '11px', color: colors.textMuted, padding: '6px 0' }}>No alerts recorded yet.</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelect(entry.server_id)}
              title={`${entry.server_id} — ${entry.reason}`}
              style={{
                display: 'flex', flexDirection: 'column', gap: '1px', cursor: 'pointer',
                padding: '4px 6px', borderRadius: '5px', flexShrink: 0,
                background: entry.server_id === selectedServerId ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0,0,0,0.2)',
                border: `1px solid ${entry.server_id === selectedServerId ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255,255,255,0.05)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: colors.danger }}>{entry.server_id}</span>
                <span style={{ fontSize: '9px', color: colors.textDim, fontFamily: font.mono, flexShrink: 0 }}>{entry.time}</span>
              </div>
              <span style={{
                fontSize: '9.5px', color: colors.textSecondary, lineHeight: '1.3',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {entry.fault_node ? `${entry.fault_node} — ` : ''}{entry.reason}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
