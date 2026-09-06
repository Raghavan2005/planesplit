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
    <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Identity gets its own full-width row now that the roomier button
          padding/font (theme.ts) would otherwise squeeze a long
          "Server (10.x.x.x/24)" label down to just an ellipsis when sharing
          a row with up to two full-size action buttons — verified live: at
          the old single-row layout, REMEDIATE + SEND TEST REQUEST at their
          new size left almost no room and the identity truncated to "S.".
          Still clamped to one line with a title tooltip as a safety net for
          extreme id lengths, just no longer fighting the buttons for space. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: STATUS_COLOR[flow.status], boxShadow: `0 0 8px ${STATUS_COLOR[flow.status]}`, flexShrink: 0 }} />
        <div
          title={`${flow.server_id} (${flow.flow})`}
          style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 'bold', flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {flow.server_id} <span style={{ fontWeight: 'normal', color: '#64748b' }}>({flow.flow})</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {isAlert && <RemediateButton serverId={flow.server_id} status={flow.status} isLive={isLive} onRemediate={onRemediate} />}
        <SendRequestButton serverId={flow.server_id} isLive={isLive} onSendRequest={onSendRequest} />
      </div>
    </div>
  )
}
