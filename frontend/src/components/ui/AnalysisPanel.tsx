import { useEffect, useState, type ReactNode } from 'react'
import type { FlowSnapshot, RequestEvent, RootCause } from '../../hooks/useSimulationSocket'
import { nodeKindFor, type NodeKind } from '../topologyStatus'
import { colors, font, nodeKindColor, requestStatusColor, requestStatusLabel, status as STATUS_COLOR } from '../../theme'
import { generateAgentReview } from '../../agentReview'

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
  // Capped at 4 (not the full history) and rendered as single-line rows —
  // this is a deliberate cap, not an accident: at this viewport size there
  // isn't room to show unbounded request history without either scrolling
  // or shrinking everything else below usability, and the 4 most recent
  // real outcomes are what actually matters for a live demo. The full
  // per-request record (id, path, reason, timestamp) is unchanged, just
  // fewer rows are shown at once.
  const recentRequests = [...requestEvents].reverse().slice(0, 3)

  return (
    <div style={panelStyle}>
      <SectionTitle>Full Analysis — {flow.server_id}</SectionTitle>

      <HopList label="Control plane (intended)" hops={flow.cp_trace} />
      {pathsMatch ? (
        <div style={mutedNoteStyle}>Data plane matches control plane exactly.</div>
      ) : (
        <HopList label="Data plane (observed)" hops={flow.dp_trace} highlight />
      )}

      {/* Short key/value fields packed two-per-row; Reason is the one field
          that can run long (a full sentence from the verifier), so it gets
          its own full-width row below the grid. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '10px', rowGap: 0 }}>
        <FieldRow label="Fault node" value={flow.fault_node ?? '—'} />
        <FieldRow label="Detected" value={flow.detected_at != null ? formatElapsed(flow.detected_at) : '—'} />
        <FieldRow label="Packet size" value={`${flow.packet_size_bytes} B`} />
        <FieldRow
          label="Correlation"
          value={correlatedGroup ? `+${correlatedGroup.flows.length - 1} under ${correlatedGroup.responsible_router}` : 'Not correlated'}
        />
      </div>
      <FieldRow label="Reason" value={flow.reason ?? '—'} clamp />

      <AgentReviewSection flow={flow} correlatedGroup={correlatedGroup} />

      <SectionTitle small>Request history{requestEvents.length > recentRequests.length ? ` (last ${recentRequests.length} of ${requestEvents.length})` : ''}</SectionTitle>
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'hidden' }}>
        {recentRequests.length === 0 ? (
          <div style={mutedNoteStyle}>No requests sent yet.</div>
        ) : (
          recentRequests.map((ev) => (
            <RequestHistoryRow key={ev.id} event={ev} highlighted={ev.server_id === flow.server_id} />
          ))
        )}
      </div>
    </div>
  )
}

// Exported so agentReview.ts can render `detected_at` as the exact same
// "Xs ago"/"Xm Ys ago" string shown here — one implementation, not two
// copies that could quietly drift apart.
export function formatElapsed(epochSeconds: number): string {
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
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  width: '100%',
  // No `minHeight: 0` / `overflow: hidden` here (there was previously,
  // before Agent Review/Alert History were added) — that combination let
  // this panel's parent flex item squeeze it, and specifically its request-
  // history section, all the way down to a real, verified 0px at the
  // 1536x864 demo viewport once those two features added real fixed
  // content above it. See the matching comment on this panel's wrapper div
  // in App.tsx: the fix is to let this panel take its natural content
  // height and let the *sidebar's* own overflowY: auto scroll any excess
  // into view, rather than silently destroying content client-side.
  lineHeight: '1.3',
} as const

const mutedNoteStyle = {
  fontSize: '12px',
  color: colors.textMuted,
} as const

function SectionTitle({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div style={{
      flexShrink: 0,
      fontSize: small ? '11px' : '12.5px', fontWeight: 'bold', color: colors.textPrimary,
      textTransform: small ? 'uppercase' : 'none', letterSpacing: small ? '0.5px' : 'normal',
      marginTop: small ? '5px' : 0,
    }}>
      {children}
    </div>
  )
}

function HopList({ label, hops, highlight }: { label: string; hops: string[]; highlight?: boolean }) {
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.textMuted, marginBottom: '3px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px' }}>
        {hops.map((hop, i) => (
          <span key={`${hop}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <HopChip hop={hop} highlight={highlight} />
            {i < hops.length - 1 && <span style={{ color: colors.textDim, fontSize: '10px' }}>→</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// The node-kind suffix ("(ROUTER)", "(GATEWAY)") that used to be printed
// inline was the single biggest cause of this list wrapping to 2 lines at
// 340px sidebar width -- e.g. "AWS_ALB (ROUTER)" is roughly twice the width
// of "AWS_ALB" alone, and multiplied across every hop in both the CP and
// DP trace that was ~90px of avoidable wrapped height. The kind is still
// fully conveyed (the dot's color already maps 1:1 to kind via
// nodeKindColor, same mapping used everywhere else in this app) and is
// still available on demand via the native title tooltip -- nothing is
// deleted, just no longer forced inline when space is this tight.
function HopChip({ hop, highlight }: { hop: string; highlight?: boolean }) {
  const isOutcomeMarker = hop === 'DROP' || hop === 'LOOP'
  const kind = isOutcomeMarker ? null : nodeKindFor(hop)
  const dotColor = kind ? nodeKindColor[kind] : colors.danger
  return (
    <span
      title={kind ? `${hop} — ${KIND_ABBR[kind]}` : hop}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px', lineHeight: '1.2',
        padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontFamily: font.mono,
        background: highlight ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255,255,255,0.04)',
        color: colors.textPrimary, fontWeight: isOutcomeMarker ? 'bold' : 'normal',
      }}>
      <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {hop}
    </span>
  )
}

// `clamp` bounds a field's value to 2 lines with an ellipsis instead of
// letting it grow unbounded — used only for "Reason", the one field that
// carries a full sentence from the verifier rather than a short token.
function FieldRow({ label, value, clamp }: { label: string; value: string; clamp?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px', lineHeight: '1.3',
      padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
    }}>
      <span style={{ color: colors.textMuted, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: colors.textPrimary, fontWeight: 'bold', textAlign: 'right', wordBreak: 'break-word',
        ...(clamp ? { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const } : {}),
      }}>{value}</span>
    </div>
  )
}

// Deterministic, evidence-only review (see ../../agentReview.ts) — every
// sentence traces back to fields already on `flow`/`correlatedGroup`, no
// LLM call and no invented confidence score (docs/INNOVATION.md §3,
// CLAUDE.md §8/§24/§25). Colored by the flow's own real status so an alert
// review reads visually distinct from a synced/tolerated one.
// The evidence list's length is bounded by how many hop-diff/correlation
// facts a given flow happens to have (0-5ish) -- not unbounded -- but
// AnalysisPanel's outer panelStyle is deliberately `overflow: hidden` (it's
// the one panel allowed to shrink under the sidebar's fixed-height siblings,
// see the panelStyle comment history), so a real alert with a long reason
// string plus 3+ correlated flows could silently get clipped by the parent
// rather than by this component's own, visible scrollbar. `headline` is
// clamped to 2 lines and `evidence` gets its own small bounded max-height +
// overflowY: auto -- same defensive pattern this codebase already uses for
// ServerStatusGrid/AlertHistory/request-history -- so if the layout runs
// out of room, it's *this* list that visibly scrolls, never invisible
// clipping at the panelStyle boundary.
function AgentReviewSection({ flow, correlatedGroup }: { flow: FlowSnapshot; correlatedGroup: RootCause | undefined }) {
  const review = generateAgentReview(flow, correlatedGroup)
  const accent = STATUS_COLOR[flow.status]
  return (
    <div style={{ flexShrink: 0 }}>
      <SectionTitle small>Agent Review</SectionTitle>
      {/* Keyed on the headline, not flow.server_id alone -- the headline
          only actually changes when the review's real content changes
          (new server selected, or a genuine status/fault_node/reason
          change), whereas this whole panel re-renders every second just to
          refresh "detected Xs ago" elsewhere. Keying on something that
          changes every second would replay the animation every second too,
          which would misrepresent a static, already-computed review as
          something freshly recomputed -- keying on the headline means the
          fade-in only ever plays for a genuinely new review. */}
      <div key={review.headline} style={{
        marginTop: '2px', padding: '5px 8px', borderRadius: '6px',
        background: `${accent}14`, border: `1px solid ${accent}40`,
        animation: 'ps-fade-in 0.25s ease-out',
      }}>
        <div
          style={{
            fontSize: '11px', fontWeight: 'bold', color: accent, lineHeight: '1.3', marginBottom: '3px',
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
          }}
        >
          {review.headline}
        </div>
        {/* Bounded, not unbounded (a flow with a long reason string plus
            several correlated flows could in principle push this tall), but
            generous enough (~7 lines) to show a normal alert's full evidence
            (CP path, DP path, hop diagnosis, verifier reason, detected-at,
            correlation) without scrolling -- verified against a live
            triggered alert. Only scrolls in the pathological case, same
            defensive pattern as ServerStatusGrid/AlertHistory. */}
        <ul style={{
          margin: '0 0 3px 0', padding: '0 0 0 15px', display: 'flex', flexDirection: 'column', gap: '2px',
          maxHeight: '96px', overflowY: 'auto',
        }}>
          {review.evidence.map((line, i) => (
            <li key={i} style={{ fontSize: '10.5px', color: colors.textSecondary, lineHeight: '1.3' }}>{line}</li>
          ))}
        </ul>
        <div
          style={{
            fontSize: '11px', color: colors.textPrimary, fontWeight: 'bold', lineHeight: '1.3',
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
          }}
        >
          → {review.recommendation}
        </div>
      </div>
    </div>
  )
}

// Single-line, information-dense row: status + server + elapsed time on
// one line, the actual path condensed and truncated with an ellipsis
// rather than wrapped — the full path for the *selected* server is already
// shown in full above via HopList, so this row only needs to identify
// which request this was and its outcome, not re-render the whole trace.
function RequestHistoryRow({ event, highlighted }: { event: RequestEvent; highlighted: boolean }) {
  const color = requestStatusColor[event.status]
  const path = event.status === 'delivered' ? event.cp_trace : event.dp_trace
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '4px', flexShrink: 0,
      background: highlighted ? 'rgba(56, 189, 248, 0.06)' : 'rgba(0,0,0,0.2)',
      border: `1px solid ${highlighted ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)'}`,
    }}>
      <span style={{ fontSize: '10px', fontWeight: 'bold', color, letterSpacing: '0.3px', flexShrink: 0, width: '52px' }}>{requestStatusLabel[event.status]}</span>
      <span style={{ fontSize: '11px', fontWeight: 'bold', color: colors.textPrimary, flexShrink: 0 }}>{event.server_id}</span>
      <span style={{ fontSize: '10px', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
        {path.join('→')}{event.reason ? ` · ${event.reason}` : ''}
      </span>
      <span style={{ fontSize: '10px', color: colors.textDim, flexShrink: 0 }}>{formatElapsed(event.sent_at)}</span>
    </div>
  )
}
