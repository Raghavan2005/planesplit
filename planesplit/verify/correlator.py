"""Multi-flow root-cause correlation — see docs/INNOVATION.md "Innovation 1"
for the full design rationale. Not part of the PS31 baseline (R1-R13); an
added-value capability, same status as closed-loop remediation.

Design summary (see the doc for the full argument): the general
fault-localization problem (infer the smallest set of components that
explains a set of symptoms) is NP-hard in general, because the root cause
isn't directly observable. Ours is narrower: Verifier._divergence_point()
already computes the exact router where a flow's actual path first differs
from its intended one (Alert.responsible_router), and the fault model only
ever targets one router per RouteUpdate. So if two alerts name the same
responsible_router, that's not an inference — it's the same deterministic
fact observed twice. The correct algorithm is therefore an exact grouping
operation, not a probabilistic or NP-hard one.
"""
from dataclasses import dataclass
from ipaddress import IPv4Network

from planesplit.verify.verifier import Alert


@dataclass
class RootCauseReport:
    responsible_router: str
    alerts: list[Alert]

    @property
    def flows(self) -> list[IPv4Network]:
        return [a.flow for a in self.alerts]

    @property
    def is_correlated(self) -> bool:
        """True when 2+ alerts share this report's root cause — the case
        that replaces N separate alerts with one shared explanation."""
        return len(self.alerts) > 1


def correlate(alerts: list[Alert]) -> list[RootCauseReport]:
    """Group alerts by responsible_router. Order of first appearance is
    preserved (relies on dict insertion order, Python 3.7+), so output is
    deterministic for a given input order — required for R13 repeatability.
    """
    groups: dict[str, list[Alert]] = {}
    for alert in alerts:
        groups.setdefault(alert.responsible_router, []).append(alert)
    return [RootCauseReport(responsible_router=router, alerts=group) for router, group in groups.items()]
