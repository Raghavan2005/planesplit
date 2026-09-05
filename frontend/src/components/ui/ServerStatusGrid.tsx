import { status as STATUS_COLOR } from '../../theme'
import type { FlowSnapshot } from '../../hooks/useSimulationSocket'

// One tile per backend server, colored by that server's own FlowSnapshot.
// status. Replaces a plain vertical CP/DP text list, which was already an
// awkward internal scroll at a dozen servers and unusable at the backend's
// real 254-server ceiling. `auto-fill` + `minmax` packs many tiles per row
// and wraps, so this stays compact and scrollable instead of growing
// linearly with server count.
interface ServerStatusGridProps {
  flows: FlowSnapshot[]
  selectedId: string | null
  onSelect: (serverId: string) => void
}

export function ServerStatusGrid({ flows, selectedId, onSelect }: ServerStatusGridProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(20px, 1fr))',
      gap: '4px',
      maxHeight: '32vh',
      overflowY: 'auto',
      padding: '4px 2px',
    }}>
      {flows.map(f => (
        <div
          key={f.server_id}
          onClick={() => onSelect(f.server_id)}
          title={`${f.server_id} — ${f.status}`}
          style={{
            aspectRatio: '1',
            borderRadius: '4px',
            cursor: 'pointer',
            background: STATUS_COLOR[f.status],
            boxShadow: f.server_id === selectedId
              ? `0 0 0 2px #fff, 0 0 8px ${STATUS_COLOR[f.status]}`
              : `0 0 6px ${STATUS_COLOR[f.status]}55`,
          }}
        />
      ))}
    </div>
  )
}
