"""Closed-loop deterministic remediation — see docs/INNOVATION.md
"Innovation 2: Closed-Loop Deterministic Remediation" for the full design
rationale. Not part of the PS31 baseline (R1-R13); an added-value capability
on top of it, same status as multi-flow correlation.

Design summary (see the doc for the full argument): the RIB is never
faulted — only UpdateChannel.apply() can put a wrong entry into a FIB — so
the correct value for any alerted flow already exists, uncorrupted, at
network.routers[alert.responsible_router].rib[alert.flow]. And because
InjectedFault is a plain per-call argument to apply() rather than
persistent per-router state, a clean corrective write needs no new
mechanism: it's just one more apply() call made with FaultMode.NONE. This
module is therefore a one-shot corrective action, not a retry loop.

Escalation for a fault that recurs after remediation is deliberately NOT
implemented here as a bespoke retry counter. Verifier's existing
grace-window logic already produces the right behavior for free:
remediate() marks 'now' as the flow's last known-good moment via
push_legitimate_change(), so if the same flow diverges again afterward,
Verifier.check() judges that fresh divergence by the exact same tolerance
rule as any other — an unexplained re-divergence outside the grace window
raises a normal Alert rather than being silently re-patched forever.
"""
from dataclasses import dataclass
from ipaddress import IPv4Network
from typing import Optional

from planesplit.core.control_plane import ControlPlaneManager
from planesplit.core.network import Network
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.verifier import Alert, Verifier


@dataclass
class RemediationResult:
    alert: Alert
    flow: IPv4Network
    router_id: str
    restored_next_hop: Optional[str]
    fixed_at: float


class Remediator:
    """Corrects a divergence Verifier already proved, by replaying the RIB's
    own uncorrupted intent through one clean UpdateChannel write.
    """

    def __init__(self, network: Network, cpm: ControlPlaneManager, channel: UpdateChannel, verifier: Verifier):
        self.network = network
        self.cpm = cpm
        self.channel = channel
        self.verifier = verifier

    def remediate(self, alert: Alert, now: float) -> RemediationResult:
        router = self.network.routers[alert.responsible_router]
        if alert.flow not in router.rib:
            # No RIB entry to restore from at all is a broken topology/alert
            # reference, not a fixable divergence — never silently write a
            # bogus None entry that could mask a worse misconfiguration
            # (same reasoning as Network._trace's unknown-router-id guard).
            raise ValueError(
                f"cannot remediate flow {alert.flow} at router {alert.responsible_router}: "
                "no RIB entry exists there to restore from"
            )
        correct_next_hop = router.rib[alert.flow]
        update = self.cpm.push_route(alert.flow, alert.responsible_router, correct_next_hop)
        self.channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=now)
        self.verifier.push_legitimate_change(alert.flow, now=now)
        return RemediationResult(
            alert=alert,
            flow=alert.flow,
            router_id=alert.responsible_router,
            restored_next_hop=correct_next_hop,
            fixed_at=now,
        )
