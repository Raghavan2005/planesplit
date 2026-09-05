"""Full-pipeline integration tests: all 6 docs/TEST_PLAN.md scenarios (M3).

Topology: hostA (10.0.0.1) -> A -> {B, D} -> C -> hostC (10.0.2.1) / hostC2
(10.0.3.1). A's next hop for a given flow is whatever the scenario pushes;
B, C, D are pre-wired so any next hop A chooses actually reaches the host.
"""
from ipaddress import IPv4Address, IPv4Network

import pytest

from planesplit.core.control_plane import ControlPlaneManager
from planesplit.core.network import Network
from planesplit.core.router import Router
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.prober import probe_flow
from planesplit.verify.verifier import Verifier

HOST_A = IPv4Address("10.0.0.1")
HOST_C1 = IPv4Address("10.0.2.1")
HOST_C2 = IPv4Address("10.0.3.1")
FLOW_1 = IPv4Network("10.0.2.0/24")
FLOW_2 = IPv4Network("10.0.3.0/24")


@pytest.fixture
def pipeline():
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

    cpm = ControlPlaneManager(net)
    channel = UpdateChannel(net)
    verifier = Verifier()
    return net, cpm, channel, verifier


def test_scenario_4_true_negative_zero_alerts_on_steady_state(pipeline):
    """Scenario 4 — runs first per TEST_PLAN.md: a converged, unchanging
    network must never alert, at any timestamp."""
    net, cpm, channel, verifier = pipeline
    update = cpm.push_route(FLOW_1, "A", "B")
    channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=0.0)
    verifier.push_legitimate_change(FLOW_1, now=0.0)

    for t in (0.5, 2.0, 5.0):
        channel.tick(t)
        intended, actual = probe_flow(net, FLOW_1, HOST_A)
        assert intended == actual
        assert verifier.check(FLOW_1, intended, actual, now=t) is None


def test_scenario_1_normal_delayed_update_converges_within_window(pipeline):
    net, cpm, channel, verifier = pipeline
    # Old route already in the FIB; new one is pushed with a 1.0s delay.
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=-10.0)
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.DELAY, delay_seconds=1.0), now=0.0)

    channel.tick(0.1)
    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended == ["A", "D", "C"]
    assert actual == ["A", "B", "C"]  # still old path
    assert verifier.check(FLOW_1, intended, actual, now=0.1) is None  # tolerated

    channel.tick(1.5)
    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert actual == ["A", "D", "C"]  # converged
    assert verifier.check(FLOW_1, intended, actual, now=1.5) is None


def test_scenario_2_dropped_update_alerts_after_window_expires(pipeline):
    net, cpm, channel, verifier = pipeline
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=-10.0)
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.DROP), now=0.0)

    channel.tick(0.5)
    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert verifier.check(FLOW_1, intended, actual, now=0.5) is None  # inside window

    channel.tick(2.5)
    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended == ["A", "D", "C"]
    assert actual == ["A", "B", "C"]  # never delivered — still the old path
    alert = verifier.check(FLOW_1, intended, actual, now=2.5)
    assert alert is not None
    assert alert.flow == FLOW_1
    assert alert.expected_path == ["A", "D", "C"]
    assert alert.actual_path == ["A", "B", "C"]


def test_scenario_3_partial_application_corrupts_prefix_and_is_detected(pipeline):
    net, cpm, channel, verifier = pipeline
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)

    channel.tick(3.0)  # well past the grace window
    intended, actual = probe_flow(net, FLOW_1, HOST_A)  # probes 10.0.2.254 (boundary)
    assert intended == ["A", "D", "C"]
    assert actual == ["A"]  # 10.0.2.254 falls outside the corrupted /25 -> blackhole
    alert = verifier.check(FLOW_1, intended, actual, now=3.0)
    assert alert is not None
    assert alert.responsible_router == "A"


def test_scenario_5_concurrent_flows_have_independent_grace_windows(pipeline):
    net, cpm, channel, verifier = pipeline
    update_x = cpm.push_route(FLOW_1, "A", "D")  # Flow X: resolves at t=1.0
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update_x, InjectedFault(mode=FaultMode.DELAY, delay_seconds=1.0), now=0.0)

    update_y = cpm.push_route(FLOW_2, "A", "D")  # Flow Y: resolves at t=0.3
    verifier.push_legitimate_change(FLOW_2, now=0.0)
    channel.apply(update_y, InjectedFault(mode=FaultMode.DELAY, delay_seconds=0.3), now=0.0)

    channel.tick(0.5)
    ix, ax = probe_flow(net, FLOW_1, HOST_A)
    iy, ay = probe_flow(net, FLOW_2, HOST_A)
    assert ix != ax and iy == ay  # X still mismatched (not due till 1.0), Y already resolved
    assert verifier.check(FLOW_1, ix, ax, now=0.5) is None  # X tolerated, inside its window
    assert verifier.check(FLOW_2, iy, ay, now=0.5) is None  # Y converged, trivially no alert

    channel.tick(1.5)
    ix, ax = probe_flow(net, FLOW_1, HOST_A)
    iy, ay = probe_flow(net, FLOW_2, HOST_A)
    assert ix == ax and iy == ay  # both converged now
    assert verifier.check(FLOW_1, ix, ax, now=1.5) is None
    assert verifier.check(FLOW_2, iy, ay, now=1.5) is None


def test_scenario_6_route_flapping_never_alerts_mid_flap_and_settles_correctly(pipeline):
    net, cpm, channel, verifier = pipeline
    flap_sequence = ["B", "D", "B", "C", "D"]  # 5 legitimate changes, ~0.4s apart
    for i, next_hop in enumerate(flap_sequence):
        t = i * 0.4
        update = cpm.push_route(FLOW_2, "A", next_hop)
        verifier.push_legitimate_change(FLOW_2, now=t)  # MUST overwrite each time
        channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=t)

        intended, actual = probe_flow(net, FLOW_2, HOST_A)
        # RIB and FIB updated together here (no delay/drop/corrupt), so this
        # probe should already match — the real assertion is no alert, ever.
        assert verifier.check(FLOW_2, intended, actual, now=t) is None

    last_change_at = 4 * 0.4  # t=1.6, the last of the 5 changes

    # T=2.5s: within 2.0s of the LAST change (t=1.6), not the first (t=0.0)
    intended, actual = probe_flow(net, FLOW_2, HOST_A)
    assert verifier.check(FLOW_2, intended, actual, now=last_change_at + 0.9) is None

    # T well past 2.0s after the last change: must show converged (PASS), matching "D"
    intended, actual = probe_flow(net, FLOW_2, HOST_A)
    assert intended == actual == ["A", "D", "C"]
    assert verifier.check(FLOW_2, intended, actual, now=last_change_at + 2.9) is None
