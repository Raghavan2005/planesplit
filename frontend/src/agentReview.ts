import type { FlowSnapshot, RootCause } from './hooks/useSimulationSocket'
import { formatElapsed } from './components/ui/AnalysisPanel'

// Deterministic, non-LLM "agent review" of a single FlowSnapshot.
//
// Per docs/INNOVATION.md section 3 ("why our version is simpler than
// 'self-healing AI' sounds") and CLAUDE.md §8/§24/§25, this project's stance
// is explicit: no external API/LLM call, no invented confidence score, no
// fabricated evidence. Every sentence this function produces is composed
// directly from fields that already exist on the real FlowSnapshot/RootCause
// the backend sent — cp_trace, dp_trace, fault_node, reason, detected_at,
// and the correlated RootCause's flows/responsible_router. If a value isn't
// present on the flow, it is never invented here.
export interface AgentReview {
  headline: string
  evidence: string[]
  recommendation: string
}

// Finds the first index where two hop lists disagree. Handles the traces
// having different lengths (e.g. a dropped packet's dp_trace ending early,
// or a corrupted route producing an extra/missing hop) by treating a
// missing hop past the end of the shorter list as itself a divergence.
function firstDivergingHop(cp: string[], dp: string[]): number {
  const len = Math.max(cp.length, dp.length)
  for (let i = 0; i < len; i++) {
    if (cp[i] !== dp[i]) return i
  }
  return -1
}

function buildHopDiffEvidence(cp: string[], dp: string[]): string[] {
  const evidence: string[] = []
  evidence.push(`Control plane path: ${cp.join(' → ')}`)
  evidence.push(`Data plane path: ${dp.join(' → ')}`)

  const divergeAt = firstDivergingHop(cp, dp)
  if (divergeAt === -1) return evidence // shouldn't happen when caller already knows they differ

  const cpHop = cp[divergeAt]
  const dpHop = dp[divergeAt]
  if (cpHop !== undefined && dpHop !== undefined) {
    evidence.push(`Hop ${divergeAt + 1}: control plane expects "${cpHop}", data plane observed "${dpHop}" instead.`)
  } else if (cpHop !== undefined && dpHop === undefined) {
    evidence.push(`Hop ${divergeAt + 1}: control plane expects "${cpHop}", but the data plane path ends before reaching it (${dp.length} hop${dp.length === 1 ? '' : 's'} observed vs ${cp.length} expected).`)
  } else if (cpHop === undefined && dpHop !== undefined) {
    evidence.push(`Hop ${divergeAt + 1}: the data plane path continues to "${dpHop}", an extra hop the control plane path does not have.`)
  }
  return evidence
}

export function generateAgentReview(flow: FlowSnapshot, correlatedGroup: RootCause | undefined): AgentReview {
  if (flow.status === 'synced') {
    return {
      headline: `${flow.server_id}: control plane and data plane paths match exactly.`,
      evidence: [`Path: ${flow.cp_trace.join(' → ')}`],
      recommendation: 'No action needed.',
    }
  }

  if (flow.status === 'tolerated') {
    const evidence = buildHopDiffEvidence(flow.cp_trace, flow.dp_trace)
    evidence.push('This divergence is still inside the verifier\'s grace window, so no alert has been raised yet.')
    return {
      headline: `${flow.server_id}: paths currently differ, but still within the grace window.`,
      evidence,
      recommendation: 'No action needed — monitoring while the change propagates.',
    }
  }

  // status === 'alert'
  const evidence = buildHopDiffEvidence(flow.cp_trace, flow.dp_trace)
  if (flow.reason) {
    evidence.push(`Verifier reason: ${flow.reason}`)
  }
  if (flow.detected_at != null) {
    evidence.push(`Detected ${formatElapsed(flow.detected_at)}.`)
  }
  if (correlatedGroup) {
    const otherFlowCount = correlatedGroup.flows.length - 1
    if (otherFlowCount > 0) {
      evidence.push(
        `Correlated: ${otherFlowCount} other flow${otherFlowCount === 1 ? '' : 's'} also diverge${otherFlowCount === 1 ? 's' : ''} at the same responsible router, ${correlatedGroup.responsible_router} — likely one shared root cause, not ${correlatedGroup.flows.length} separate faults.`
      )
    }
  }

  const faultNode = flow.fault_node ?? 'an unidentified node'
  return {
    headline: flow.fault_node && flow.reason
      ? `${flow.server_id}: divergence detected at ${flow.fault_node} — ${flow.reason}`
      : `${flow.server_id}: divergence detected at ${faultNode}.`,
    evidence,
    recommendation: flow.fault_node
      ? `Run REMEDIATE on ${flow.fault_node} to restore convergence.`
      : 'Run REMEDIATE on the affected server to restore convergence.',
  }
}
