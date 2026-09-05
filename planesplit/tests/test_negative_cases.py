"""Negative/edge-case coverage for Q2 (docs/REQUIREMENTS.md), the categories
from CLAUDE.md §10 not already exercised by test_scenarios.py's true-negative
(Scenario 4) and false-positive-attempt (Scenario 5) cases: malformed input,
missing/unknown entities, duplicate events, out-of-order events, and large
input.
"""
from ipaddress import IPv4Address, IPv4Network

import pytest

from planesplit.core.network import Network
from planesplit.core.packet import Packet
from planesplit.core.router import Router
from planesplit.verify.prober import boundary_probe_address
from planesplit.verify.verifier import Verifier

HOST_A = IPv4Address("10.0.0.1")
HOST_C = IPv4Address("10.0.2.1")
FLOW = IPv4Network("10.0.2.0/24")


# ---------------------------------------------------------------------------
# Malformed / empty input
# ---------------------------------------------------------------------------

def test_malformed_ip_string_is_rejected_at_construction():
    """We never accept a garbage 'IP' silently — ipaddress raises immediately,
    so a malformed probe can't slip through and be misinterpreted downstream."""
    with pytest.raises(ValueError):
        IPv4Address("this-is-not-an-ip")


def test_trace_raises_for_host_with_no_known_attachment():
    """Probing a host the topology never declared (empty/missing setup) must
    fail loudly, not silently return an empty or partial path."""
    net = Network()
    net.add_router(Router("A"))
    pkt = Packet(src=IPv4Address("192.168.9.9"), dst=HOST_C)
    with pytest.raises(ValueError, match="no ingress router known"):
        net.trace_intended(pkt)


def test_trace_raises_for_broken_topology_reference():
    """A host attached to a router id that was never registered (typo'd
    config, partially-built topology) must raise, not silently produce an
    empty trace that could be misread as 'converged, no divergence' by the
    Verifier if both RIB and FIB break the same way."""
    net = Network()
    net.attach_host(HOST_A, "GHOST")  # "GHOST" was never add_router()'d
    pkt = Packet(src=HOST_A, dst=HOST_C)
    with pytest.raises(ValueError, match="unknown router id"):
        net.trace_intended(pkt)


def test_boundary_probe_address_on_a_slash_32_flow_does_not_crash():
    """A /32 has no distinct host range (hosts() is empty) — must fall back
    to the network address instead of raising or returning nothing."""
    addr = boundary_probe_address(IPv4Network("10.0.2.5/32"))
    assert addr == IPv4Address("10.0.2.5")


def test_verifier_check_with_empty_paths_on_both_sides_is_a_trivial_pass():
    """Two empty lists are trivially equal, so check() reports no divergence.
    In practice this can only happen if a caller bypasses Network entirely
    (Network._trace now raises rather than ever returning an empty path from
    a broken reference — see test_trace_raises_for_broken_topology_reference)
    — documented here so the behavior is intentional, not accidental."""
    v = Verifier()
    assert v.check(FLOW, [], [], now=0.0) is None


# ---------------------------------------------------------------------------
# Duplicate / out-of-order events
# ---------------------------------------------------------------------------

def test_duplicate_probe_is_idempotent():
    """Firing the identical probe twice (same flow, same paths, same `now`)
    must produce the identical result both times — check() must not have
    hidden mutable state that makes the second call differ from the first."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    first = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.0)
    second = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.0)
    assert first is not None and second is not None
    assert (first.flow, first.responsible_router, first.expected_path, first.actual_path) == (
        second.flow, second.responsible_router, second.expected_path, second.actual_path,
    )


def test_out_of_order_probe_calls_are_each_independently_correct():
    """check() is a pure function of its arguments plus the grace-window
    dict — it never mutates state itself, so calling it with a LATER then an
    EARLIER `now` (as if two probes arrived out of order) must not corrupt
    anything: each call is judged only against its own `now`."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    later = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.0)  # window long expired
    earlier = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=1.0)  # still inside window
    assert later is not None  # correctly alerts
    assert earlier is None  # correctly tolerates, unaffected by having been evaluated second


def test_duplicate_legitimate_change_at_same_timestamp_is_safe():
    v = Verifier()
    v.push_legitimate_change(FLOW, now=2.0)
    v.push_legitimate_change(FLOW, now=2.0)  # duplicate notification, same instant
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=2.5)
    assert alert is None  # still well inside the window


def test_out_of_order_legitimate_change_does_not_regress_the_window():
    """A stale legitimate-change notification arriving after a newer one
    (simulating reordering) must not move last_legitimate_change_at
    backwards — doing so would shrink the window for a flow that actually
    just changed more recently, producing a false-positive ALERT instead of
    a correctly-TOLERATED mismatch."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=5.0)   # the real, most recent change
    v.push_legitimate_change(FLOW, now=1.0)   # a stale notification arriving late, out of order
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.9)  # 0.9s after the real change
    assert alert is None  # must still be tolerated — the stale update must not have won


# ---------------------------------------------------------------------------
# Large input
# ---------------------------------------------------------------------------

def test_large_chain_topology_traces_without_hanging_or_looping():
    """A long router chain (well beyond the 3-5 node MVP scope) must still
    terminate — this is a smoke test for the visited-set cycle guard and the
    max_hops safety cap, not a claim that arbitrarily large topologies are a
    supported/optimized use case (see docs/MVP.md's resolved LPM-scaling
    jury comment)."""
    net = Network()
    chain = [f"R{i}" for i in range(30)]
    for rid in chain:
        net.add_router(Router(rid))
    for i in range(len(chain) - 1):
        net.routers[chain[i]].fib[FLOW] = chain[i + 1]
    net.routers[chain[-1]].fib[FLOW] = None  # local delivery at the end of the chain
    net.attach_host(HOST_A, chain[0])
    net.attach_host(HOST_C, chain[-1])

    pkt = Packet(src=HOST_A, dst=HOST_C)
    path = net.trace_actual(pkt)
    assert path[0] == chain[0]
    assert len(path) <= 16  # max_hops cap — a 30-hop chain is truncated, not hung


def test_routing_loop_terminates_via_visited_set_not_infinite_loop():
    net = Network()
    for rid in ("A", "B"):
        net.add_router(Router(rid))
    net.routers["A"].fib[FLOW] = "B"
    net.routers["B"].fib[FLOW] = "A"  # A <-> B loop, never reaches a destination
    net.attach_host(HOST_A, "A")

    pkt = Packet(src=HOST_A, dst=HOST_C)
    path = net.trace_actual(pkt)
    assert path == ["A", "B"]  # stops the instant B's next hop (A) is already visited
