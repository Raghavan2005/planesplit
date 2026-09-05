// 2D projection of the same conceptual ingress -> gateway -> server tiers the
// 3D scene uses (see components/scene/layout.ts FIXED_POSITIONS/
// computeNodePositions) -- deliberately NOT the same coordinates (3D uses a
// world-space [x,y,z] tuple meant for a rotating camera; this produces a flat
// SVG viewBox layout meant for a fixed top-down read), but the same real
// tiering: Users on the left, Firewall/AWS_ALB in a shared middle tier,
// backend servers stacked on the right, spaced out procedurally by count the
// same way computeNodePositions spaces servers along Z.
export interface MapPoint {
  x: number
  y: number
}

export type MapPositions = Record<string, MapPoint>

export interface MapLayout {
  positions: MapPositions
  width: number
  height: number
}

const TIER_X = { ingress: 90, gateway: 380, server: 660 } as const
const ROW_SPACING = 64
const MIN_HEIGHT = 240
const PADDING_Y = 60
export const MAP_WIDTH = 760

export function computeMapPositions(serverIds: string[]): MapLayout {
  const rowCount = Math.max(serverIds.length, 2) // keep room for Firewall+AWS_ALB even at 1 server
  const height = Math.max(MIN_HEIGHT, rowCount * ROW_SPACING + PADDING_Y * 2)
  const midY = height / 2

  const positions: MapPositions = {
    Users: { x: TIER_X.ingress, y: midY },
    Firewall: { x: TIER_X.gateway, y: midY - ROW_SPACING * 0.65 },
    AWS_ALB: { x: TIER_X.gateway, y: midY + ROW_SPACING * 0.65 },
  }

  const startY = midY - ((serverIds.length - 1) * ROW_SPACING) / 2
  serverIds.forEach((id, i) => {
    positions[id] = { x: TIER_X.server, y: startY + i * ROW_SPACING }
  })

  return { positions, width: MAP_WIDTH, height }
}

// Union of every flow's real cp_trace/dp_trace consecutive-hop pairs,
// deduped regardless of direction (A->B and B->A render as the same edge).
// Mirrors PathLine.tsx/Packet.tsx's own filter (`!== 'DROP' && !== 'LOOP'`)
// for the same reason: those are outcome markers the prober appends to a
// trace, not real topology nodes with a position.
export function collectEdges(traces: string[][]): [string, string][] {
  const seen = new Map<string, [string, string]>()
  for (const trace of traces) {
    for (let i = 0; i < trace.length - 1; i++) {
      const a = trace[i]
      const b = trace[i + 1]
      if (a === 'DROP' || a === 'LOOP' || b === 'DROP' || b === 'LOOP') continue
      const key = [a, b].sort().join('|')
      if (!seen.has(key)) seen.set(key, [a, b])
    }
  }
  return [...seen.values()]
}

// A real path's valid, position-bearing hops only -- used both to draw the
// ambient/discrete traffic dot's motion path and to find where a dropped
// packet's marker should rest (the last real hop before 'DROP').
export function realHops(trace: string[], positions: MapPositions): string[] {
  return trace.filter((p) => p !== 'DROP' && p !== 'LOOP' && positions[p])
}

// Interpolates a point at fraction `t` (0..1) along the polyline formed by
// `hops`' real positions, proportional to real segment length (not just
// "hop index / hop count") so a discrete request_event marker moves at a
// visually even pace over a path whose segments differ wildly in on-screen
// length (e.g. the long Users->Firewall leg vs. a short Firewall->Server
// leg once many servers are stacked close together).
export function pointAlongHops(hops: string[], positions: MapPositions, t: number): MapPoint | null {
  const pts = hops.map((h) => positions[h]).filter((p): p is MapPoint => Boolean(p))
  if (pts.length === 0) return null
  if (pts.length === 1) return pts[0]

  const segLengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  const total = segLengths.reduce((a, b) => a + b, 0)
  let target = Math.max(0, Math.min(1, t)) * total

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i]
    if (target <= segLen || i === segLengths.length - 1) {
      const localT = segLen === 0 ? 0 : Math.min(1, target / segLen)
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * localT,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * localT,
      }
    }
    target -= segLen
  }
  return pts[pts.length - 1]
}
