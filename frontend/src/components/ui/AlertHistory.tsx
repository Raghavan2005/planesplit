import { colors, font, secondaryButtonStyle } from '../../theme'

export interface AlertHistoryEntry {
  id: number
  server_id: string
  reason: string
  fault_node: string | null
  time: string
  detectedAt: number | null
}

// Persistent, capped log of every real 'alert' status transition App()'s
// flows-diffing effect has observed (see App.tsx's `alertHistory` state,
// pushed alongside the existing ephemeral toast) — every field is real:
// id/time are the same synchronously-captured values the toast uses,
// reason/fault_node come straight off the FlowSnapshot that triggered the
// transition.
//
// Deliberately shows only the single most recent entry, not a scrolling
// list of all 30 — FullHistoryModal's Event Log already contains every one
// of these transitions (they're logged there too, via the exact same
// flows-diffing effect), so a second scrollable list here was pure
// duplication competing for the same tight vertical budget. This compact
// form keeps the one piece of information that's actually load-bearing at a
// glance (the most recent alert, click-to-select still wired to it) plus a
// direct link into the full, unfiltered log for everything before it.
interface AlertHistoryProps {
  entries: AlertHistoryEntry[]
  onSelect: (serverId: string) => void
  selectedServerId: string | null
  onOpenFullHistory: () => void
}

export function AlertHistory({ entries, onSelect, selectedServerId, onOpenFullHistory }: AlertHistoryProps) {
  const latest = entries[0]
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{
        fontSize: '11px', fontWeight: 'bold', color: colors.textPrimary,
        marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>Alert History</span>
        <span style={{ fontSize: '10px', color: colors.textMuted, fontWeight: 'normal' }}>{entries.length} recorded</span>
      </div>
      {latest === undefined ? (
        <div style={{ fontSize: '12px', color: colors.textMuted, padding: '4px 0' }}>No alerts recorded yet.</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
          <div
            onClick={() => onSelect(latest.server_id)}
            title={`${latest.server_id} — ${latest.reason}`}
            style={{
              display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer', flex: '1 1 auto', minWidth: 0,
              padding: '5px 8px', borderRadius: '5px',
              background: latest.server_id === selectedServerId ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0,0,0,0.2)',
              border: `1px solid ${latest.server_id === selectedServerId ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255,255,255,0.05)'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: colors.danger }}>{latest.server_id}</span>
              <span style={{ fontSize: '10px', color: colors.textDim, fontFamily: font.mono, flexShrink: 0 }}>{latest.time}</span>
            </div>
            <span style={{
              fontSize: '10.5px', color: colors.textSecondary, lineHeight: '1.3',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {latest.fault_node ? `${latest.fault_node} — ` : ''}{latest.reason}
            </span>
          </div>
          <button
            onClick={onOpenFullHistory}
            style={{ ...secondaryButtonStyle, padding: '0 10px', fontSize: '10px', flexShrink: 0 }}
          >
            View All
          </button>
        </div>
      )}
    </div>
  )
}
