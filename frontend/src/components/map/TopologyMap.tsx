import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FlowSnapshot } from '../../hooks/useSimulationSocket'
import type { ActiveRequestEvent } from '../../hooks/useActiveRequestEvents'
import { nodeKindFor, statusForNode, isResponsibleForActiveFault, type NodeKind, type NodeStatus } from '../topologyStatus'
import { colors, status as STATUS_COLOR, nodeKindColor, requestStatusColor, requestStatusLabel, font, secondaryButtonStyle } from '../../theme'
import { computeMapPositions, collectEdges, realHops, pointAlongHops, type MapPoint, type MapPositions } from './mapLayout'

// Converts a client-space (mouse/pointer) coordinate into the SVG's own
// user-space coordinate system, correctly accounting for the viewBox scale
// and centering `preserveAspectRatio="xMidYMid meet"` applies -- a plain
// clientX/clientY delta divided by a guessed scale factor would drift as
// soon as the panel isn't exactly viewBox-sized, which it almost never is.
function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): MapPoint {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const svgP = pt.matrixTransform(ctm.inverse())
  return { x: svgP.x, y: svgP.y }
}

const DRAG_THRESHOLD_PX = 3

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
  activeRequestEvents: ActiveRequestEvent[]
}

export function TopologyMap({ flows, selectedServerId, onSelectServer, activeRequestEvents }: TopologyMapProps) {
  // Computed unconditionally (never behind the empty-roster early return
  // below) because the hooks right after depend on them -- React requires
  // every hook to run in the same order on every render, and computeMapPositions/
  // collectEdges are safe to call with an empty serverIds array.
  const serverIds = flows.map((f) => f.server_id)
  const { positions, width, height } = computeMapPositions(serverIds)
  const edges = collectEdges(flows.flatMap((f) => [f.cp_trace, f.dp_trace]))
  const nodeIds = ['Users', 'Firewall', 'AWS_ALB', ...serverIds]

  // Manual, session-only repositioning -- every node still starts at its
  // real computed tier/row layout (`positions` above, unchanged), this only
  // layers per-id pixel overrides on top once a judge/demo-er drags a node
  // to declutter a busy diagram. Never persisted, never fed back into any
  // real state (topology, status, edges are all still computed from the
  // exact same `flows`) -- purely a client-side view convenience.
  const [dragOverrides, setDragOverrides] = useState<MapPositions>({})
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragStateRef = useRef<{ id: string; pointerId: number; offset: MapPoint; moved: boolean } | null>(null)

  // Clears any dragged positions the instant the real roster changes
  // (scale/reset/preset) -- without this, a server id that happens to
  // survive the change (e.g. "Server", present at nearly every count)
  // stays pinned at its stale dragged pixel position, overlapping the
  // freshly computed layout right after a demo-critical reset.
  const rosterKey = serverIds.join('|')
  const prevRosterKeyRef = useRef(rosterKey)
  useEffect(() => {
    if (prevRosterKeyRef.current !== rosterKey) {
      prevRosterKeyRef.current = rosterKey
      setDragOverrides({})
    }
  }, [rosterKey])

  const effectivePositions = useMemo(
    () => ({ ...positions, ...dragOverrides }),
    [positions, dragOverrides],
  )

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const handleNodePointerDown = (id: string) => (e: ReactPointerEvent<SVGGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const pointer = toSvgPoint(svg, e.clientX, e.clientY)
    const current = effectivePositions[id]
    if (!current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStateRef.current = {
      id,
      pointerId: e.pointerId,
      offset: { x: current.x - pointer.x, y: current.y - pointer.y },
      moved: false,
    }
  }

  const handleNodePointerMove = (id: string) => (e: ReactPointerEvent<SVGGElement>) => {
    const drag = dragStateRef.current
    const svg = svgRef.current
    if (!drag || !svg || drag.id !== id || drag.pointerId !== e.pointerId) return
    const pointer = toSvgPoint(svg, e.clientX, e.clientY)
    const nextX = pointer.x + drag.offset.x
    const nextY = pointer.y + drag.offset.y
    if (!drag.moved) {
      const start = effectivePositions[id]
      if (start && Math.hypot(nextX - start.x, nextY - start.y) < DRAG_THRESHOLD_PX) return
      drag.moved = true
    }
    setDragOverrides((prev) => ({
      ...prev,
      [id]: { x: clamp(nextX, 24, width - 24), y: clamp(nextY, 24, height - 24) },
    }))
  }

  const handleNodePointerUp = (id: string, onSelect: (() => void) | undefined) => (e: ReactPointerEvent<SVGGElement>) => {
    const drag = dragStateRef.current
    if (drag && drag.id === id && drag.pointerId === e.pointerId) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      const wasMoved = drag.moved
      dragStateRef.current = null
      // A drag that never crossed the threshold is a plain click -- fire
      // the real select handler instead of silently swallowing the tap.
      if (!wasMoved) onSelect?.()
      return
    }
    onSelect?.()
  }

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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {Object.keys(dragOverrides).length > 0 && (
        <button
          onClick={() => setDragOverrides({})}
          style={{ ...secondaryButtonStyle, position: 'absolute', top: 10, right: 10, zIndex: 1, padding: '5px 10px', fontSize: '10px' }}
        >
          RESET LAYOUT
        </button>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {edges.map(([a, b]) => {
          const pa = effectivePositions[a]
          const pb = effectivePositions[b]
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
          <AmbientFlowDots key={f.server_id} flow={f} positions={effectivePositions} />
        ))}

        {nodeIds.map((id) => {
          const onSelect = nodeKindFor(id) === 'server' ? () => onSelectServer(id) : undefined
          return (
            <MapNode
              key={id}
              id={id}
              point={effectivePositions[id]}
              kind={nodeKindFor(id)}
              status={statusForNode(id, flows)}
              isFaultOrigin={isResponsibleForActiveFault(id, flows)}
              isSelected={id === selectedServerId}
              onSelect={onSelect}
              onPointerDown={handleNodePointerDown(id)}
              onPointerMove={handleNodePointerMove(id)}
              onPointerUp={handleNodePointerUp(id, onSelect)}
            />
          )
        })}

        {/* Discrete, user-triggered requests -- visually distinct from the
            ambient dots above (brighter, larger, pulsing while in flight,
            ends in an explicit outcome label) and drawn last so they're
            never occluded by a node or an ambient dot. */}
        {activeRequestEvents.map((active) => (
          <RequestMarker key={active.event.id} active={active} positions={effectivePositions} />
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
  onPointerDown: (e: ReactPointerEvent<SVGGElement>) => void
  onPointerMove: (e: ReactPointerEvent<SVGGElement>) => void
  onPointerUp: (e: ReactPointerEvent<SVGGElement>) => void
}

function MapNode({ id, point, kind, status, isFaultOrigin, isSelected, onPointerDown, onPointerMove, onPointerUp }: MapNodeProps) {
  if (!point) return null
  const ringColor = status ? STATUS_COLOR[status] : 'rgba(148, 163, 184, 0.4)'
  const fill = nodeKindColor[kind]

  return (
    <g
      transform={`translate(${point.x}, ${point.y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      {isFaultOrigin && (
        <circle r={30} fill="none" stroke={colors.danger} strokeWidth={2} opacity={0.6}>
          <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      <NodeShape kind={kind} fill={fill} ringColor={isSelected ? '#ffffff' : ringColor} ringWidth={isSelected ? 4 : 2.5} />
      <text y={kind === 'server' ? 40 : 34} textAnchor="middle" fontSize={12} fill={colors.textSecondary} fontFamily={font.sans}>
        {id}
      </text>
    </g>
  )
}

// How long a discrete request_event's marker takes to travel its real path
// on screen. Purely a visual pace -- the backend result (delivered/
// diverged/dropped) is already final and known the instant the event
// arrives; this only controls how long the "travelling" phase reads before
// the outcome label appears at its real final position.
const TRAVEL_DURATION_MS = 1400

function RequestMarker({ active, positions }: { active: ActiveRequestEvent; positions: MapPositions }) {
  // A local per-frame tick, not derived from props -- this marker's
  // position depends on wall-clock elapsed time since it was first seen,
  // which changes every animation frame regardless of whether any parent
  // prop (flows, requestEvents) has changed in that same window.
  const [, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const { event, firstSeenAt } = active
  // Delivered means cp_trace/dp_trace already agree, so either is fine;
  // diverged/dropped travel the real OBSERVED (dp_trace) path, since that's
  // what actually happened, including where a dropped packet really
  // stopped -- not the intended path it never fully took.
  const path = event.status === 'delivered' ? event.cp_trace : event.dp_trace
  const hops = realHops(path, positions)
  if (hops.length === 0) return null

  const progress = Math.min(1, (performance.now() - firstSeenAt) / TRAVEL_DURATION_MS)
  const point = pointAlongHops(hops, positions, progress)
  if (!point) return null

  const color = requestStatusColor[event.status]
  const arrived = progress >= 1

  return (
    <g>
      <circle cx={point.x} cy={point.y} r={arrived ? 7 : 5.5} fill={color} stroke="#ffffff" strokeWidth={1.5}>
        {!arrived && <animate attributeName="opacity" values="1;0.45;1" dur="0.35s" repeatCount="indefinite" />}
      </circle>
      {arrived && (
        <text
          x={point.x} y={point.y - 18} textAnchor="middle" fontSize={11} fontWeight="bold"
          fill={color} fontFamily={font.sans}
        >
          {requestStatusLabel[event.status]}
        </text>
      )}
    </g>
  )
}

function NodeShape({ kind, fill, ringColor, ringWidth }: { kind: NodeKind; fill: string; ringColor: string; ringWidth: number }) {
  if (kind === 'user') return <circle r={20} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  if (kind === 'gateway') return <rect x={-26} y={-18} width={52} height={36} rx={8} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  if (kind === 'router') return <circle r={24} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
  return <rect x={-18} y={-24} width={36} height={48} rx={4} fill={fill} stroke={ringColor} strokeWidth={ringWidth} />
}
