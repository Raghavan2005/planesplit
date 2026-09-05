"""Shared scenario definitions — the single source of truth for both
cli/demo.py and tests/test_repeatability.py (docs/BUILD_PLAN.md §0 repo
layout note). Each scenario function builds a fresh pipeline internally and
returns a deterministic list of ProbeResult — no wall clock, no randomness,
so calling the same scenario twice must produce byte-identical output (R13).
"""
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network
from typing import Optional

from planesplit.core.control_plane import ControlPlaneManager
from planesplit.core.network import Network
from planesplit.core.router import Router
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.prober import probe_flow
from planesplit.verify.verifier import Alert, Verifier

HOST_A = IPv4Address("10.0.0.1")
HOST_C1 = IPv4Address("10.0.2.1")
HOST_C2 = IPv4Address("10.0.3.1")
FLOW_1 = IPv4Network("10.0.2.0/24")
FLOW_2 = IPv4Network("10.0.3.0/24")


@dataclass
class ProbeResult:
    scenario: str
    label: str
    flow: IPv4Network
    at: float
    intended: list[str]
    actual: list[str]
    alert: Optional[Alert]

    @property
    def status(self) -> str:
        if self.alert is not None:
            return "ALERT"
        if self.intended != self.actual:
            return "TOLERATED"
        return "PASS"


def _build_pipeline() -> tuple[Network, ControlPlaneManager, UpdateChannel, Verifier]:
    net = Network()
    for rid in ("A", "B", "C", "D"):
        net.add_router(Router(rid))
    for flow in (FLOW_1, FLOW_2):
        net.routers["B"].rib[flow] = "C"
        net.routers["B"].fib[flow] = "C"
        net.routers["D"].rib[flow] = "C"
        net.routers["D"].fib[flow] = "C"
        net.routers["C"].rib[flow] = None
        net.routers["C"].fib[flow] = None
    net.attach_host(HOST_A, "A")
    net.attach_host(HOST_C1, "C")
    net.attach_host(HOST_C2, "C")
    return net, ControlPlaneManager(net), UpdateChannel(net), Verifier()


def _probe(scenario: str, label: str, net: Network, verifier: Verifier, flow: IPv4Network, host: IPv4Address, at: float) -> ProbeResult:
    intended, actual = probe_flow(net, flow, host)
    alert = verifier.check(flow, intended, actual, now=at)
    return ProbeResult(scenario=scenario, label=label, flow=flow, at=at, intended=intended, actual=actual, alert=alert)


def scenario_1_normal_delayed_update() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=-10.0)
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.DELAY, delay_seconds=1.0), now=0.0)

    results = []
    channel.tick(0.1)
    results.append(_probe("Scenario 1", "T=0.1s (before delay elapses)", net, verifier, FLOW_1, HOST_A, 0.1))
    channel.tick(1.5)
    results.append(_probe("Scenario 1", "T=1.5s (converged)", net, verifier, FLOW_1, HOST_A, 1.5))
    return results


def scenario_2_dropped_update() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=-10.0)
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.DROP), now=0.0)

    results = []
    channel.tick(0.5)
    results.append(_probe("Scenario 2", "T=0.5s (within window)", net, verifier, FLOW_1, HOST_A, 0.5))
    channel.tick(2.5)
    results.append(_probe("Scenario 2", "T=2.5s (window expired)", net, verifier, FLOW_1, HOST_A, 2.5))
    return results


def scenario_3_partial_application() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)
    channel.tick(3.0)
    return [_probe("Scenario 3", "T=3.0s (corrupted /25 FIB entry)", net, verifier, FLOW_1, HOST_A, 3.0)]


def scenario_4_true_negative() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=0.0)
    verifier.push_legitimate_change(FLOW_1, now=0.0)

    results = []
    for t in (0.5, 2.0, 5.0):
        channel.tick(t)
        results.append(_probe("Scenario 4", f"T={t}s (steady state)", net, verifier, FLOW_1, HOST_A, t))
    return results


def scenario_5_concurrent_independent_flows() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    update_x = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update_x, InjectedFault(mode=FaultMode.DELAY, delay_seconds=1.0), now=0.0)

    update_y = cpm.push_route(FLOW_2, "A", "D")
    verifier.push_legitimate_change(FLOW_2, now=0.0)
    channel.apply(update_y, InjectedFault(mode=FaultMode.DELAY, delay_seconds=0.3), now=0.0)

    results = []
    channel.tick(0.5)
    results.append(_probe("Scenario 5", "Flow X @ T=0.5s", net, verifier, FLOW_1, HOST_A, 0.5))
    results.append(_probe("Scenario 5", "Flow Y @ T=0.5s", net, verifier, FLOW_2, HOST_A, 0.5))
    channel.tick(1.5)
    results.append(_probe("Scenario 5", "Flow X @ T=1.5s", net, verifier, FLOW_1, HOST_A, 1.5))
    results.append(_probe("Scenario 5", "Flow Y @ T=1.5s", net, verifier, FLOW_2, HOST_A, 1.5))
    return results


def scenario_6_route_flapping() -> list[ProbeResult]:
    net, cpm, channel, verifier = _build_pipeline()
    flap_sequence = ["B", "D", "B", "C", "D"]
    results = []
    for i, next_hop in enumerate(flap_sequence):
        t = i * 0.4
        update = cpm.push_route(FLOW_2, "A", next_hop)
        verifier.push_legitimate_change(FLOW_2, now=t)
        channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=t)
        results.append(_probe("Scenario 6", f"flap {i + 1}/5 @ T={t:.1f}s", net, verifier, FLOW_2, HOST_A, t))

    last_change_at = 4 * 0.4
    results.append(_probe("Scenario 6", f"T={last_change_at + 0.9:.1f}s (within final window)", net, verifier, FLOW_2, HOST_A, last_change_at + 0.9))
    results.append(_probe("Scenario 6", f"T={last_change_at + 2.9:.1f}s (settled)", net, verifier, FLOW_2, HOST_A, last_change_at + 2.9))
    return results


ALL_SCENARIOS = [
    scenario_4_true_negative,      # runs first, per docs/TEST_PLAN.md
    scenario_1_normal_delayed_update,
    scenario_2_dropped_update,
    scenario_3_partial_application,
    scenario_5_concurrent_independent_flows,
    scenario_6_route_flapping,
]

# Keyed by the scenario's own number from docs/TEST_PLAN.md — deliberately
# NOT the same as ALL_SCENARIOS' run order (which puts Scenario 4 first), so
# `--scenario 3` in the CLI means "TEST_PLAN.md Scenario 3", not "the 3rd
# entry in run order".
SCENARIO_BY_NUMBER = {
    1: scenario_1_normal_delayed_update,
    2: scenario_2_dropped_update,
    3: scenario_3_partial_application,
    4: scenario_4_true_negative,
    5: scenario_5_concurrent_independent_flows,
    6: scenario_6_route_flapping,
}
