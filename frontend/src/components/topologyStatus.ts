import type { FlowSnapshot } from '../hooks/useSimulationSocket'

// The real, fixed node kinds this topology's routers fall into (see
// backend/state.py ROUTERS = ["Users", "Firewall", "Server", "AWS_ALB"]).
// Shared by the 3D scene (RouterNode/ServerRack) and the 2D TopologyMap so
// a given router reads as the same conceptual thing in both views, even
// though the geometry differs per view.
export type NodeKind = 'user' | 'gateway' | 'router' | 'server'

export function nodeKindFor(nodeId: string): NodeKind {
  if (nodeId === 'Users') return 'user'
  if (nodeId === 'Firewall') return 'gateway'
  if (nodeId === 'AWS_ALB') return 'router'
  return 'server'
}

export type NodeStatus = 'synced' | 'tolerated' | 'alert' | null

const STATUS_RANK: Record<'synced' | 'tolerated' | 'alert', number> = {
  synced: 0,
  tolerated: 1,
  alert: 2,
}

// Firewall/AWS_ALB/Users never appear in `flows` directly (flows are keyed
// by backend server_id) -- before this, that meant those three nodes were
// always visually inert (null status) except for a hardcoded "always
// highlight Users" fault indicator that didn't reflect real per-node
// state. This scans every flow's real cp_trace/dp_trace for the node id
// and reports the worst real status among any flow that actually routes
// through it, so Firewall/AWS_ALB/Users each honestly reflect the traffic
// crossing them, exactly like a server's own FlowSnapshot.status already
// does for itself.
export function statusForNode(nodeId: string, flows: FlowSnapshot[]): NodeStatus {
  let worst: NodeStatus = null
  for (const f of flows) {
    if (f.cp_trace.includes(nodeId) || f.dp_trace.includes(nodeId)) {
      if (worst === null || STATUS_RANK[f.status] > STATUS_RANK[worst]) {
        worst = f.status
      }
    }
  }
  return worst
}

// True if this node is the real, currently-reported cause of an active
// alert (Alert.responsible_router, surfaced as FlowSnapshot.fault_node) --
// replaces the old hardcoded "the fault visual always targets Users"
// assumption with the backend's own real attribution.
export function isResponsibleForActiveFault(nodeId: string, flows: FlowSnapshot[]): boolean {
  return flows.some((f) => f.status === 'alert' && f.fault_node === nodeId)
}
