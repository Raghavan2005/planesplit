import { warningButtonStyle, disabledButtonStyle } from '../../theme'

// Calls the real backend `remediate` action (backend/state.py::
// SimulationState.remediate -> the tested planesplit Remediator) -- no
// optimistic client-side status flip. The button stays visible until the
// next real snapshot confirms the fix; a backend rejection (e.g. the
// alert already cleared) surfaces via useSimulationSocket's error path,
// not a silent no-op.
interface RemediateButtonProps {
  serverId: string
  status: 'synced' | 'tolerated' | 'alert'
  isLive: boolean
  onRemediate: (serverId: string) => void
}

export function RemediateButton({ serverId, status, isLive, onRemediate }: RemediateButtonProps) {
  if (status !== 'alert') return null
  return (
    <button
      disabled={!isLive}
      onClick={() => onRemediate(serverId)}
      style={{ ...(isLive ? warningButtonStyle : disabledButtonStyle), padding: '8px 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
    >
      REMEDIATE
    </button>
  )
}
