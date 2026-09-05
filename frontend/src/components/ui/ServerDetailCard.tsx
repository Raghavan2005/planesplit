import { status as STATUS_COLOR } from '../../theme'
import type { FlowSnapshot } from '../../hooks/useSimulationSocket'

// Detail for whichever single server is currently selected in the status
// grid above — same fields the old per-server list item showed (CP/DP
// trace, packet size), just for one server at a time instead of all of
// them stacked in a scrolling list. See AnalysisPanel for the deeper,
// full-metadata view (fault_node, reason, detected_at, request history).
interface ServerDetailCardProps {
  flow: FlowSnapshot | undefined
}

export function ServerDetailCard({ flow }: ServerDetailCardProps) {
  if (!flow) return null
  return (
    <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: '12px', color: '#f8fafc', marginBottom: '8px', fontWeight: 'bold' }}>
        {flow.server_id} <span style={{ fontWeight: 'normal', color: '#64748b' }}>({flow.flow})</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '4px' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', marginRight: '8px', boxShadow: '0 0 8px #22c55e' }}></div>
        <span style={{ fontSize: '12px', width: '30px', color: '#94a3b8' }}>CP:</span>
        <span style={{ fontSize: '12px', fontWeight: 'bold', wordBreak: 'break-word' }}>{flow.cp_trace.join(' → ')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLOR[flow.status], marginRight: '8px', boxShadow: `0 0 8px ${STATUS_COLOR[flow.status]}` }}></div>
        <span style={{ fontSize: '12px', width: '30px', color: '#94a3b8' }}>DP:</span>
        <span style={{ fontSize: '12px', fontWeight: 'bold', wordBreak: 'break-word', color: flow.status === 'synced' ? 'white' : STATUS_COLOR[flow.status] }}>{flow.dp_trace.join(' → ')}</span>
      </div>
      {/* Real value from backend/state.py's validate_packet_size — every
          packet this simulation carries is a genuine, bounds-checked
          Ethernet frame size (64-1500 bytes), not a placeholder. */}
      {typeof flow.packet_size_bytes === 'number' && (
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px', paddingLeft: '18px' }}>
          Packet size: <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>{flow.packet_size_bytes} B</span>
        </div>
      )}
    </div>
  )
}
