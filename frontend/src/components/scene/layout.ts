// Fixed ingress tier: shared by every server regardless of scale. Backend
// servers (from data.flows[].server_id) are laid out procedurally in
// computeNodePositions below, since the count is dynamic (1-254, see
// backend/state.py MAX_SERVERS — the real IPv4 host-octet ceiling, not an
// arbitrary UX cap).
export type NodePositions = Record<string, [number, number, number]>
export type LinkPair = [string, string]

export const FIXED_POSITIONS: NodePositions = {
  Users: [-6, 0, 0],
  Firewall: [-1, 0, -2.5],
  AWS_ALB: [-1, 0, 2.5],
}

export function computeNodePositions(serverIds: string[]): NodePositions {
  const positions: NodePositions = { ...FIXED_POSITIONS }
  const spacing = 3
  const startZ = -((serverIds.length - 1) * spacing) / 2
  serverIds.forEach((id, i) => {
    positions[id] = [5, 0, startZ + i * spacing]
  })
  return positions
}

export function computeBaseLinks(serverIds: string[]): LinkPair[] {
  const links: LinkPair[] = [['Users', 'Firewall'], ['Users', 'AWS_ALB']]
  serverIds.forEach((id) => {
    links.push(['Firewall', id])
    links.push(['AWS_ALB', id])
  })
  return links
}
