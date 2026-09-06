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
      gridTemplateColumns: 'repeat(auto-fill, minmax(12px, 1fr))',
      gap: '3px',
      // Capped intentionally low: at realistic demo server counts (a
      // handful of tiles) this never gets close to the cap and never
      // scrolls. It only kicks in as a last-resort fallback at very high
      // server counts (the backend's real 254-server ceiling), where no
      // amount of flex layout can fit hundreds of tiles on screen at once
      // without either scrolling this one grid or shrinking tiles into
      // illegibility.
      maxHeight: '60px',
      overflowY: 'auto',
      padding: '2px',
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
