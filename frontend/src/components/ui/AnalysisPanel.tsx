import { useEffect, useState, type ReactNode } from 'react'
import type { FlowSnapshot, RequestEvent, RootCause } from '../../hooks/useSimulationSocket'
import { nodeKindFor, type NodeKind } from '../topologyStatus'
import { colors, font, nodeKindColor, requestStatusColor, requestStatusLabel } from '../../theme'

// The "full metadata / full analysis" view: every field backend/state.py's
// snapshot()/send_request() already compute for the selected server, laid
// out so nothing has to be inferred or cross-referenced by hand -- the
// hop-by-hop CP/DP path (each hop tagged by its real node kind), the real
// fault_node/reason/detected_at an Alert actually carries, correlation
// membership against the live root-cause list, and a running request
// history. Every value here comes straight from a FlowSnapshot/RequestEvent
// already flowing through useSimulationSocket -- nothing is computed or
// guessed client-side.
interface AnalysisPanelProps {
  flow: FlowSnapshot | undefined
  rootCauses: RootCause[]
  requestEvents: RequestEvent[]
}

const KIND_ABBR: Record<NodeKind, string> = {
  user: 'USER',
  gateway: 'GATEWAY',
  router: 'ROUTER',
  server: 'SERVER',
}

export function AnalysisPanel({ flow, rootCauses, requestEvents }: AnalysisPanelProps) {
  // Forces a re-render every second purely so "detected Xs ago" / request
  // history timestamps stay live -- doesn't affect what data is shown, only
  // when the elapsed-time strings below get recomputed.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!flow) {
    return (
      <div style={panelStyle}>
        <div style={{ color: colors.textMuted, fontSize: '12px', textAlign: 'center', padding: '12px 0' }}>
          No server selected yet.
        </div>
      </div>
    )
  }

  const pathsMatch = flow.cp_trace.join('>') === flow.dp_trace.join('>')
  const correlatedGroup = rootCauses.find((rc) => rc.flows.includes(flow.flow))
  const recentRequests = [...requestEvents].reverse().slice(0, 15)

  return (
    <div style={panelStyle}>
      <SectionTitle>Full Analysis — {flow.server_id}</SectionTitle>

      <HopList label="Control plane (intended)" hops={flow.cp_trace} />
      {pathsMatch ? (
        <div style={mutedNoteStyle}>Data plane matches control plane exactly.</div>
      ) : (
        <HopList label="Data plane (observed)" hops={flow.dp_trace} highlight />
      )}

      <FieldRow label="Fault node" value={flow.fault_node ?? '—'} />
      <FieldRow label="Reason" value={flow.reason ?? '—'} />
      <FieldRow label="Detected" value={flow.detected_at != null ? formatElapsed(flow.detected_at) : '—'} />
      <FieldRow label="Packet size" value={`${flow.packet_size_bytes} B`} />
      <FieldRow
        label="Correlation"
        value={
          correlatedGroup
            ? `Shared with ${correlatedGroup.flows.length - 1} other flow(s) under ${correlatedGroup.responsible_router}`
            : 'Not correlated'
        }
      />

      <SectionTitle small>Request history</SectionTitle>
      {recentRequests.length === 0 ? (
        <div style={mutedNoteStyle}>No requests sent yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
          {recentRequests.map((ev) => (
            <RequestHistoryRow key={ev.id} event={ev} highlighted={ev.server_id === flow.server_id} />
          ))}
        </div>
      )}
    </div>
  )
}

function formatElapsed(epochSeconds: number): string {
  const deltaSeconds = Math.max(0, Date.now() / 1000 - epochSeconds)
  if (deltaSeconds < 60) return `${Math.round(deltaSeconds)}s ago`
  const minutes = Math.floor(deltaSeconds / 60)
  const seconds = Math.round(deltaSeconds % 60)
  return `${minutes}m ${seconds}s ago`
}

const panelStyle = {
  padding: '12px',
  background: 'rgba(0,0,0,0.3)',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.05)',
} as const

const mutedNoteStyle = {
  fontSize: '11px',
  color: colors.textMuted,
  marginBottom: '8px',
} as const

function SectionTitle({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div style={{
      fontSize: small ? '10px' : '12px', fontWeight: 'bold', color: colors.textPrimary,
      textTransform: small ? 'uppercase' : 'none', letterSpacing: small ? '0.5px' : 'normal',
      marginTop: small ? '14px' : 0, marginBottom: '8px',
    }}>
      {children}
    </div>
  )
}

function HopList({ label, hops, highlight }: { label: string; hops: string[]; highlight?: boolean }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.textMuted, marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
        {hops.map((hop, i) => (
          <span key={`${hop}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <HopChip hop={hop} highlight={highlight} />
            {i < hops.length - 1 && <span style={{ color: colors.textDim, fontSize: '11px' }}>→</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function HopChip({ hop, highlight }: { hop: string; highlight?: boolean }) {
  const isOutcomeMarker = hop === 'DROP' || hop === 'LOOP'
  const kind = isOutcomeMarker ? null : nodeKindFor(hop)
  const dotColor = kind ? nodeKindColor[kind] : colors.danger
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: font.mono,
      background: highlight ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255,255,255,0.04)',
      color: colors.textPrimary, fontWeight: isOutcomeMarker ? 'bold' : 'normal',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {hop}{kind ? ` (${KIND_ABBR[kind]})` : ''}
    </span>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px',
      padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <span style={{ color: colors.textPrimary, fontWeight: 'bold', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function RequestHistoryRow({ event, highlighted }: { event: RequestEvent; highlighted: boolean }) {
  const color = requestStatusColor[event.status]
  const path = event.status === 'delivered' ? event.cp_trace : event.dp_trace
  return (
    <div style={{
      padding: '6px 8px', borderRadius: '6px',
      background: highlighted ? 'rgba(56, 189, 248, 0.06)' : 'rgba(0,0,0,0.2)',
      border: `1px solid ${highlighted ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: colors.textPrimary }}>{event.server_id}</span>
        <span style={{ fontSize: '10px', fontWeight: 'bold', color, letterSpacing: '0.5px' }}>{requestStatusLabel[event.status]}</span>
      </div>
      <div style={{ fontSize: '10px', color: colors.textSecondary, wordBreak: 'break-word' }}>{path.join(' → ')}</div>
      {event.reason && <div style={{ fontSize: '10px', color: colors.warning, marginTop: '2px' }}>{event.reason}</div>}
      <div style={{ fontSize: '10px', color: colors.textDim, marginTop: '2px' }}>{formatElapsed(event.sent_at)}</div>
    </div>
  )
}
