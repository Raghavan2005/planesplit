import { font } from '../../theme'
import type { ConnectionStatus } from '../../hooks/useSimulationSocket'

interface ConnectingOverlayProps {
  connectionStatus: ConnectionStatus
}

export function ConnectingOverlay({ connectionStatus }: ConnectingOverlayProps) {
  const isRetrying = connectionStatus === 'closed'
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(2, 6, 23, 0.75)', backdropFilter: 'blur(4px)',
      fontFamily: font.sans,
    }}>
      <div style={{
        background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px', padding: '36px 44px', textAlign: 'center',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
      }}>
        <div style={{
          width: '36px', height: '36px', margin: '0 auto 18px',
          border: `3px solid ${isRetrying ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.25)'}`,
          borderTopColor: isRetrying ? '#ef4444' : '#38bdf8',
          borderRadius: '50%', animation: 'ps-spin 0.8s linear infinite',
        }} />
        <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          {isRetrying ? 'Backend disconnected' : 'Connecting to PlaneSplit backend'}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '8px', maxWidth: '260px' }}>
          {isRetrying
            ? 'Reconnecting — backend disconnected. No simulated state is shown until a real snapshot arrives.'
            : 'Waiting for the first real network snapshot from the backend.'}
        </div>
      </div>
    </div>
  )
}
