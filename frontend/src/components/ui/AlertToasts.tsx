export interface Toast {
  id: number
  server_id: string
  reason: string
  time: string
}

// Alert toasts — pushed by App()'s flows-diffing effect the instant a
// server's real status transitions into 'alert' (not a simulated/hardcoded
// notification). Absolutely positioned within the 'main' viewport cell
// (which has position: relative) rather than fixed over the whole page —
// same scoping ConnectingOverlay uses — so a fired alert floats over the
// open 3D/2D viewport instead of covering the right sidebar's interactive
// controls (server tiles, REMEDIATE/SEND REQUEST buttons), which a
// page-fixed z-index:999 stack previously did.
interface AlertToastsProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function AlertToasts({ toasts, onDismiss }: AlertToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'absolute', top: '12px', right: '12px', zIndex: 30,
      display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 14px', borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)',
          boxShadow: '0 8px 20px -6px rgba(0, 0, 0, 0.5)', color: '#f8fafc',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          pointerEvents: 'auto',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              Alert — {t.server_id}
            </div>
            <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: '1.4' }}>{t.reason}</div>
          </div>
          <button onClick={() => onDismiss(t.id)} style={{
            background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
            fontSize: '14px', lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
      ))}
    </div>
  )
}
