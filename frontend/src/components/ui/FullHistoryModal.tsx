import type { ReactNode } from 'react'
import { colors, font, requestStatusColor, requestStatusLabel } from '../../theme'
import { formatElapsed } from './AnalysisPanel'
import type { RequestEvent } from '../../hooks/useSimulationSocket'
import type { LogEntry } from './LiveConsole'

// The "elsewhere" LiveConsole.tsx's own top-of-file comment says doesn't
// exist yet. LiveConsole deliberately tails only the last 7 lines, filtered
// to `system` + whichever single server is selected — a real "tail -f"
// view, not a place to review a whole session. This modal is that missing
// "read the full log" destination: the *entire* `logs` array (all up to
// 300, every server, unfiltered) and the *entire* `requestEvents` array
// (all up to 50), each in its own real overflowY:auto scroll container.
// Nothing here is synthesized — both arrays are the exact same real state
// LiveConsole/AnalysisPanel already render, just shown in full instead of
// tailed/capped. See App.tsx's `logs`/`requestEvents` and
// AnalysisPanel.tsx's `RequestHistoryRow` for the source of truth this
// mirrors.
interface FullHistoryModalProps {
  open: boolean
  onClose: () => void
  logs: LogEntry[]
  requestEvents: RequestEvent[]
}

export function FullHistoryModal({ open, onClose, logs, requestEvents }: FullHistoryModalProps) {
  if (!open) return null

  // Newest-first for both lists — most useful when scanning "what just
  // happened", consistent between the two sections.
  const logsNewestFirst = [...logs].reverse()
  const requestsNewestFirst = [...requestEvents].reverse()

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.75)', backdropFilter: 'blur(4px)',
        fontFamily: font.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(15, 23, 42, 0.97)', border: `1px solid ${colors.borderStrong}`,
          borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
          width: 'min(1100px, 92vw)', height: 'min(760px, 88vh)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
        }}>
          <div>
            <div style={{ color: colors.textHeading, fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.4px' }}>
              Full History
            </div>
            <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '2px' }}>
              Every event and every action taken this session — unfiltered, unlimited by viewport height.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close full history"
            style={{
              background: 'transparent', border: `1px solid ${colors.borderStrong}`, borderRadius: '6px',
              color: colors.textSecondary, width: '28px', height: '28px', cursor: 'pointer',
              fontSize: '14px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', gap: '1px', background: colors.border }}>
          <div style={{ flex: '1 1 55%', minWidth: 0, display: 'flex', flexDirection: 'column', background: colors.bgConsole }}>
            <SectionHeader>Event Log ({logs.length})</SectionHeader>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '6px 16px', fontFamily: font.mono, fontSize: '11px', lineHeight: '1.6' }}>
              {logsNewestFirst.length === 0 ? (
                <div style={{ color: colors.textDim }}>No events yet.</div>
              ) : (
                logsNewestFirst.map((l) => (
                  <div key={l.id} style={{ whiteSpace: 'pre-wrap', color: colors.textConsole }}>
                    <span style={{ color: colors.textDim }}>{l.time}</span>{'  '}
                    <span style={{ color: l.tag === 'system' ? colors.accent : '#a78bfa', fontWeight: 'bold' }}>{l.tag.padEnd(10)}</span>
                    {l.message}
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ flex: '1 1 45%', minWidth: 0, display: 'flex', flexDirection: 'column', background: colors.bgConsole }}>
            <SectionHeader>Actions &amp; Outcomes ({requestEvents.length})</SectionHeader>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {requestsNewestFirst.length === 0 ? (
                <div style={{ color: colors.textDim, fontSize: '11px', fontFamily: font.mono }}>No requests sent yet.</div>
              ) : (
                requestsNewestFirst.map((ev) => <RequestRow key={ev.id} event={ev} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '6px 16px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px',
      color: colors.textMuted, borderBottom: `1px solid ${colors.borderSubtle}`, flexShrink: 0,
    }}>
      {children}
    </div>
  )
}

// Mirrors AnalysisPanel.tsx's `RequestHistoryRow` rendering pattern
// (status badge, server id, condensed path + reason, elapsed time) so the
// same kind of data looks the same in both places — just without the
// "highlighted" per-selected-server variant, since this view is
// deliberately server-agnostic.
function RequestRow({ event }: { event: RequestEvent }) {
  const color = requestStatusColor[event.status]
  const path = event.status === 'delivered' ? event.cp_trace : event.dp_trace
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '4px', flexShrink: 0,
      background: 'rgba(0,0,0,0.2)', border: `1px solid ${colors.borderSubtle}`,
    }}>
      <span style={{ fontSize: '9px', fontWeight: 'bold', color, letterSpacing: '0.3px', flexShrink: 0, width: '48px' }}>
        {requestStatusLabel[event.status]}
      </span>
      <span style={{ fontSize: '10px', fontWeight: 'bold', color: colors.textPrimary, flexShrink: 0 }}>{event.server_id}</span>
      <span style={{
        fontSize: '9px', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', flex: 1, minWidth: 0,
      }}>
        {path.join('→')}{event.reason ? ` · ${event.reason}` : ''}
      </span>
      <span style={{ fontSize: '9px', color: colors.textDim, flexShrink: 0 }}>{formatElapsed(event.sent_at)}</span>
    </div>
  )
}
