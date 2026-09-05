import { status as STATUS_COLOR } from '../../theme'

const ITEMS: Array<['synced' | 'tolerated' | 'alert', string]> = [
  ['synced', 'Synced'],
  ['tolerated', 'Tolerated'],
  ['alert', 'Alert'],
]

export function StatusLegend() {
  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '4px' }}>
      {ITEMS.map(([key, label]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: STATUS_COLOR[key] }} />
          <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        </div>
      ))}
    </div>
  )
}
