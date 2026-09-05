export interface Toast {
  id: number
  server_id: string
  reason: string
  time: string
}

// Floating alert toasts — pushed by App()'s flows-diffing effect the
// instant a server's real status transitions into 'alert' (not a
// simulated/hardcoded notification). Fixed-positioned so it floats above
// every grid cell regardless of where it's mounted in the DOM.
interface AlertToastsProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function AlertToasts({ toasts, onDismiss }: AlertToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'fixed', top: '84px', right: '20px', zIndex: 999,
      display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 14px', borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)',
          boxShadow: '0 8px 20px -6px rgba(0, 0, 0, 0.5)', color: '#f8fafc',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
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
