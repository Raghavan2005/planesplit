import { status as STATUS_COLOR } from '../../theme'
import type { FlowSnapshot } from '../../hooks/useSimulationSocket'
import { RemediateButton } from './RemediateButton'
import { SendRequestButton } from './SendRequestButton'

// Detail for whichever single server is currently selected in the status
// grid above — same fields the old per-server list item showed (CP/DP
// trace, packet size), just for one server at a time instead of all of
// them stacked in a scrolling list. See AnalysisPanel for the deeper,
// full-metadata view (fault_node, reason, detected_at, request history).
interface ServerDetailCardProps {
  flow: FlowSnapshot | undefined
  isLive: boolean
  onRemediate: (serverId: string) => void
  onSendRequest: (serverId: string) => void
}

// Deliberately just the identity + status + actions for the selected
// server -- the full CP/DP hop-by-hop trace and packet size used to be
// duplicated here AND in AnalysisPanel's "Full Analysis" section directly
// below it (same data, two renderings). AnalysisPanel already shows the
// complete trace, so this card no longer repeats it; that's the vertical
// space this redesign recovers, not a loss of information anywhere in the
// sidebar.
export function ServerDetailCard({ flow, isLive, onRemediate, onSendRequest }: ServerDetailCardProps) {
  if (!flow) return null
  const isAlert = flow.status === 'alert'
  return (
    <div style={{ padding: '7px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_COLOR[flow.status], boxShadow: `0 0 8px ${STATUS_COLOR[flow.status]}`, flexShrink: 0 }} />
      {/* Identity is the one thing here allowed to shrink — it truncates
          with an ellipsis (full value still on hover via title) rather than
          forcing the two action buttons' own labels to get any smaller,
          since the buttons' text is what a judge actually needs to read to
          operate the demo. This is what fixed the real bug: at up to two
          full-width buttons plus a long "Server (10.x.x.x/24)" label, the
          unclamped version overflowed this 340px sidebar horizontally. */}
      <div
        title={`${flow.server_id} (${flow.flow})`}
        style={{ fontSize: '11px', color: '#f8fafc', fontWeight: 'bold', flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {flow.server_id} <span style={{ fontWeight: 'normal', color: '#64748b' }}>({flow.flow})</span>
      </div>
      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
        {isAlert && <RemediateButton serverId={flow.server_id} status={flow.status} isLive={isLive} onRemediate={onRemediate} />}
        <SendRequestButton serverId={flow.server_id} isLive={isLive} onSendRequest={onSendRequest} />
      </div>
    </div>
  )
}
