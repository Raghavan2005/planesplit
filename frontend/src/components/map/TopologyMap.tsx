import type { FlowSnapshot } from '../../hooks/useSimulationSocket'
import { nodeKindFor, statusForNode, isResponsibleForActiveFault, type NodeKind, type NodeStatus } from '../topologyStatus'
import { colors, status as STATUS_COLOR, nodeKindColor, font } from '../../theme'
import { computeMapPositions, collectEdges, realHops, type MapPositions } from './mapLayout'

// 2D counterpart to the 3D scene (App.tsx's <Canvas> + scene/* components) --
// same real per-node status (statusForNode/isResponsibleForActiveFault,
// shared via components/topologyStatus.ts so the two views can never
// silently disagree), same real edges (the union of every flow's actual
// cp_trace/dp_trace hop pairs, not a hand-drawn diagram), same ambient
// per-flow traffic. Rendered as plain SVG rather than a canvas/WebGL layer
// -- this view is meant to be read as a flat, at-a-glance network diagram,
// not explored with a camera.
interface TopologyMapProps {
  flows: FlowSnapshot[]
  selectedServerId: string | null
  onSelectServer: (serverId: string) => void
}

export function TopologyMap({ flows, selectedServerId, onSelectServer }: TopologyMapProps) {
  if (flows.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: colors.textMuted, fontFamily: font.sans, fontSize: '13px',
      }}>
        No servers in the topology yet.
      </div>
    )
  }

  const serverIds = flows.map((f) => f.server_id)
  const { positions, width, height } = computeMapPositions(serverIds)
  const edges = collectEdges(flows.flatMap((f) => [f.cp_trace, f.dp_trace]))
  const nodeIds = ['Users', 'Firewall', 'AWS_ALB', ...serverIds]

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {edges.map(([a, b]) => {
          const pa = positions[a]
          const pb = positions[b]
          if (!pa || !pb) return null
          return (
            <line
              key={`${a}|${b}`}
              x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke="rgba(148, 163, 184, 0.25)" strokeWidth={1.5}
            />
          )
        })}

        {flows.map((f) => (
          <AmbientFlowDots key={f.server_id} flow={f} positions={positions} />
        ))}

        {nodeIds.map((id) => (
          <MapNode
            key={id}
            id={id}
            point={positions[id]}
            kind={nodeKindFor(id)}
            status={statusForNode(id, flows)}
            isFaultOrigin={isResponsibleForActiveFault(id, flows)}
            isSelected={id === selectedServerId}
            onSelect={nodeKindFor(id) === 'server' ? () => onSelectServer(id) : undefined}
          />
        ))}
      </svg>
    </div>
  )
}

function hopsToPathD(hops: string[], positions: MapPositions): string | null {
  if (hops.length < 2) return null
  return hops.map((id, i) => `${i === 0 ? 'M' : 'L'} ${positions[id].x} ${positions[id].y}`).join(' ')
}

// Same perpetual ambient animation the 3D scene's Packet.tsx renders (real
// cp_trace/dp_trace data, not synthesized) -- driven by native SVG
// <animateMotion> rather than a per-frame React/JS loop so it stays cheap
// even at the backend's real server ceiling (up to 254 flows at once).
function AmbientFlowDots({ flow, positions }: { flow: FlowSnapshot; positions: MapPositions }) {
  const cpHops = realHops(flow.cp_trace, positions)
  const dpHops = realHops(flow.dp_trace, positions)
  const cpPath = hopsToPathD(cpHops, positions)
  const dpPath = hopsToPathD(dpHops, positions)
  const dpColor = flow.status === 'synced' ? colors.dpSuccess : STATUS_COLOR[flow.status]
  const cpId = `cp-path-${flow.server_id}`
  const dpId = `dp-path-${flow.server_id}`

  return (
    <g>
      {cpPath && (
        <>
          <path id={cpId} d={cpPath} fill="none" stroke="none" />
          <circle r={3} fill={colors.success}>
            <animateMotion dur={`${2.4 + cpHops.length * 0.4}s`} repeatCount="indefinite">
              <mpath href={`#${cpId}`} />
            </animateMotion>
          </circle>
        </>
      )}
      {dpPath && (
        <>
          <path id={dpId} d={dpPath} fill="none" stroke="none" />
          <circle r={3} fill={dpColor}>
            <animateMotion dur={`${2.4 + dpHops.length * 0.4}s`} begin="0.4s" repeatCount="indefinite">
              <mpath href={`#${dpId}`} />
            </animateMotion>
          </circle>
        </>
      )}
    </g>
  )
}

interface MapNodeProps {
  id: string
  point: { x: number; y: number } | undefined
  kind: NodeKind
  status: NodeStatus
  isFaultOrigin: boolean
  isSelected: boolean
  onSelect: (() => void) | undefined
}

function MapNode({ id, point, kind, status, isFaultOrigin, isSelected, onSelect }: MapNodeProps) {
  if (!point) return null
  const ringColor = status ? STATUS_COLOR[status] : 'rgba(148, 163, 184, 0.4)'
  const fill = nodeKindColor[kind]
  const clickable = onSelect !== undefined

  return (
    <g
      transform={`translate(${point.x}, ${point.y})`}
      onClick={onSelect}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      {isFaultOrigin && (
        <circle r={30} fill="none" stroke={colors.danger} strokeWidth={2} opacity={0.6}>
          <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      <NodeShape kind={kind} fill={fill} ringColor={isSelected ? '#ffffff' : ringColor} ringWidth={isSelected ? 4 : 2.5} />
      <text y={kind === 'server' ? 40 : 34} textAnchor="middle" fontSize={11} fill={colors.textSecondary} fontFamily={font.sans}>
        {id}
      </text>
    </g>
  )
}

function NodeShape({ kind, fill, ringColor, ringWidth }: { kind: NodeKind; fill: string; ringColor: string; ringWidth: number }) {
  if (kind === 'user') return <circle r={20} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  if (kind === 'gateway') return <rect x={-26} y={-18} width={52} height={36} rx={8} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  if (kind === 'router') return <circle r={24} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  return <rect x={-18} y={-24} width={36} height={48} rx={4} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
}
