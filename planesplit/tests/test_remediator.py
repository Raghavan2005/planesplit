"""Tests for verify/remediator.py — see docs/INNOVATION.md "Innovation 2".

Reuses the same 4-router topology (A -> {B, D} -> C) as test_scenarios.py.
"""
from ipaddress import IPv4Address, IPv4Network

import pytest

from planesplit.core.control_plane import ControlPlaneManager, RouteUpdate
from planesplit.core.network import Network
from planesplit.core.router import Router
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.prober import probe_flow
from planesplit.verify.remediator import Remediator
from planesplit.verify.verifier import Alert, Verifier

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


def test_remediate_fixes_corrupt_fault_and_reverification_passes(pipeline):
    net, cpm, channel, verifier = pipeline
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)
    channel.tick(3.0)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    alert = verifier.check(FLOW_1, intended, actual, now=3.0)
    assert alert is not None  # same as test_scenario_3

    result = Remediator(net, cpm, channel, verifier).remediate(alert, now=3.0)
    assert result.router_id == "A"
    assert result.restored_next_hop == "D"
    assert result.flow == FLOW_1
    assert result.fixed_at == 3.0

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended == actual == ["A", "D", "C"]
    assert verifier.check(FLOW_1, intended, actual, now=3.0) is None


def test_remediate_fixes_dropped_update(pipeline):
    net, cpm, channel, verifier = pipeline
    channel.apply(cpm.push_route(FLOW_1, "A", "B"), InjectedFault(mode=FaultMode.NONE), now=-10.0)
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.DROP), now=0.0)
    channel.tick(2.5)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    alert = verifier.check(FLOW_1, intended, actual, now=2.5)
    assert alert is not None

    Remediator(net, cpm, channel, verifier).remediate(alert, now=2.5)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended == actual == ["A", "D", "C"]
    assert verifier.check(FLOW_1, intended, actual, now=2.5) is None


def test_remediate_does_not_disturb_other_flows_grace_window(pipeline):
    """Remediating Flow 1 must not touch Flow 2's independent, still-pending
    grace window — mirrors Scenario 5's per-flow-state guarantee."""
    net, cpm, channel, verifier = pipeline

    # Flow 1: corrupted, will be remediated.
    update_1 = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update_1, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)

    # Flow 2: legitimate change with a 1.0s delay, still pending at t=0.5.
    update_2 = cpm.push_route(FLOW_2, "A", "D")
    verifier.push_legitimate_change(FLOW_2, now=0.0)
    channel.apply(update_2, InjectedFault(mode=FaultMode.DELAY, delay_seconds=1.0), now=0.0)

    channel.tick(0.5)
    intended_1, actual_1 = probe_flow(net, FLOW_1, HOST_A)
    alert_1 = verifier.check(FLOW_1, intended_1, actual_1, now=0.5)
    assert alert_1 is None  # still inside FLOW_1's own window at t=0.5

    channel.tick(3.0)
    intended_1, actual_1 = probe_flow(net, FLOW_1, HOST_A)
    alert_1 = verifier.check(FLOW_1, intended_1, actual_1, now=3.0)
    assert alert_1 is not None

    Remediator(net, cpm, channel, verifier).remediate(alert_1, now=3.0)

    # Flow 2 must still read as converged/tolerated on its own terms —
    # unaffected by Flow 1's remediation bookkeeping.
    intended_2, actual_2 = probe_flow(net, FLOW_2, HOST_A)
    assert intended_2 == actual_2 == ["A", "D", "C"]  # its own 1.0s delay had already elapsed by t=3.0
    assert verifier.check(FLOW_2, intended_2, actual_2, now=3.0) is None


def test_remediate_raises_if_no_rib_entry_exists_at_responsible_router(pipeline):
    net, cpm, channel, verifier = pipeline
    fake_alert = Alert(
        flow=FLOW_1,
        responsible_router="A",  # A never gets a RIB entry in this fixture unless push_route is called
        expected_path=["A", "B", "C"],
        actual_path=["A"],
        detected_at=1.0,
        reason="synthetic alert for negative-case testing",
    )
    with pytest.raises(ValueError, match="no RIB entry exists"):
        Remediator(net, cpm, channel, verifier).remediate(fake_alert, now=1.0)


def test_recorruption_within_grace_window_after_remediation_is_tolerated(pipeline):
    net, cpm, channel, verifier = pipeline
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)
    channel.tick(3.0)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    alert = verifier.check(FLOW_1, intended, actual, now=3.0)
    Remediator(net, cpm, channel, verifier).remediate(alert, now=3.0)

    # Something re-writes the same FIB entry to a wrong next hop shortly
    # after the repair — modeling a rogue/buggy write path directly (not
    # via cpm.push_route, so the RIB stays correct and only the FIB goes
    # bad again), NOT a legitimate change, so push_legitimate_change is
    # deliberately not called here.
    #
    # Deliberately NOT reusing FaultMode.CORRUPT's prefix-narrowing here: it
    # anchors the narrowed prefix at the flow's own network address, so a
    # second narrowing produces the same sub-block already superseded by
    # remediation's wider, correct /24 entry — invisible to the boundary
    # probe. A plain wrong-next-hop write is what actually reproduces a
    # detectable divergence a second time.
    bad_update = RouteUpdate(flow=FLOW_1, router_id="A", next_hop="B")
    channel.apply(bad_update, InjectedFault(mode=FaultMode.NONE), now=3.5)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended != actual
    # 3.5 - 3.0 = 0.5s < GRACE_WINDOW_SECONDS (2.0s): tolerated, not alerted.
    assert verifier.check(FLOW_1, intended, actual, now=3.5) is None


def test_recorruption_after_grace_window_is_realerted_not_silently_swallowed(pipeline):
    """The escalation case: remediation is a one-shot fix, not a promise
    that the underlying problem is gone. If the same flow diverges again
    well outside the grace window, Verifier must raise a fresh Alert —
    proving a persistent fault surfaces to a human/operator instead of
    being silently re-patched forever."""
    net, cpm, channel, verifier = pipeline
    update = cpm.push_route(FLOW_1, "A", "D")
    verifier.push_legitimate_change(FLOW_1, now=0.0)
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)
    channel.tick(3.0)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    alert = verifier.check(FLOW_1, intended, actual, now=3.0)
    Remediator(net, cpm, channel, verifier).remediate(alert, now=3.0)

    # See the comment in the sibling "within grace window" test for why a
    # plain wrong-next-hop write is used here rather than FaultMode.CORRUPT.
    bad_update = RouteUpdate(flow=FLOW_1, router_id="A", next_hop="B")
    channel.apply(bad_update, InjectedFault(mode=FaultMode.NONE), now=6.0)

    intended, actual = probe_flow(net, FLOW_1, HOST_A)
    assert intended != actual
    # 6.0 - 3.0 = 3.0s > GRACE_WINDOW_SECONDS (2.0s): a fresh, real alert.
    new_alert = verifier.check(FLOW_1, intended, actual, now=6.0)
    assert new_alert is not None
    assert new_alert.flow == FLOW_1
