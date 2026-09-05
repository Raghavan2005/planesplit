"""Unit tests for core/packet.py, core/router.py, core/network.py (M1).

Topology used throughout:

    hostA (10.0.0.1) -- A -- B -- C -- hostC (10.0.2.1)
                         \\__ D __/      (alternate path)

A's RIB/FIB route 10.0.2.0/24 via B (primary) unless a test sets up the
alternate via D instead.
"""
from ipaddress import IPv4Address, IPv4Network

from planesplit.core.network import Network
from planesplit.core.packet import Packet
from planesplit.core.router import Router

HOST_A = IPv4Address("10.0.0.1")
HOST_C = IPv4Address("10.0.2.1")
DST_NET = IPv4Network("10.0.2.0/24")


def build_network(a_next_hop: str = "B") -> Network:
    net = Network()
    a, b, c, d = Router("A"), Router("B"), Router("C"), Router("D")
    for r in (a, b, c, d):
        net.add_router(r)

    a.rib[DST_NET] = a_next_hop
    a.fib[DST_NET] = a_next_hop
    b.rib[DST_NET] = "C"
    b.fib[DST_NET] = "C"
    d.rib[DST_NET] = "C"
    d.fib[DST_NET] = "C"
    c.rib[DST_NET] = None  # directly connected, deliver locally
    c.fib[DST_NET] = None

    net.attach_host(HOST_A, "A")
    net.attach_host(HOST_C, "C")
    return net


def test_packet_defaults_to_empty_trace():
    pkt = Packet(src=HOST_A, dst=HOST_C)
    assert pkt.trace == []


def test_router_forward_lpm_picks_longest_prefix():
    router = Router("A")
    router.fib[IPv4Network("10.0.0.0/16")] = "WIDE"
    router.fib[IPv4Network("10.0.2.0/24")] = "NARROW"
    pkt = Packet(src=HOST_A, dst=HOST_C)
    next_hop = router.forward(pkt, "fib")
    assert next_hop == "NARROW"
    assert pkt.trace == ["A"]


def test_router_forward_no_match_returns_none():
    router = Router("A")
    router.fib[IPv4Network("192.168.0.0/24")] = "SOMEWHERE"
    pkt = Packet(src=HOST_A, dst=HOST_C)
    next_hop = router.forward(pkt, "fib")
    assert next_hop is None
    assert pkt.trace == ["A"]  # router still records that it was visited


def test_network_trace_intended_walks_primary_path():
    net = build_network(a_next_hop="B")
    pkt = Packet(src=HOST_A, dst=HOST_C)
    path = net.trace_intended(pkt)
    assert path == ["A", "B", "C"]
    assert net.delivered(pkt, HOST_C)


def test_network_trace_actual_walks_alternate_path():
    net = build_network(a_next_hop="B")
    net.routers["A"].fib[DST_NET] = "D"  # FIB diverges from RIB
    pkt = Packet(src=HOST_A, dst=HOST_C)
    path = net.trace_actual(pkt)
    assert path == ["A", "D", "C"]
    assert net.delivered(pkt, HOST_C)


def test_network_trace_blackhole_when_fib_has_no_route():
    net = build_network(a_next_hop="B")
    del net.routers["A"].fib[DST_NET]  # FIB has no route at all (blackhole)
    pkt = Packet(src=HOST_A, dst=HOST_C)
    path = net.trace_actual(pkt)
    assert path == ["A"]  # stops immediately, never reaches C
    assert not net.delivered(pkt, HOST_C)


def test_network_trace_intended_and_actual_are_independent_calls():
    """Calling trace_intended then trace_actual on the same packet must not
    let the first call's trace leak into the second — each _trace() resets
    packet.trace before walking."""
    net = build_network(a_next_hop="B")
    net.routers["A"].fib[DST_NET] = "D"
    pkt = Packet(src=HOST_A, dst=HOST_C)
    intended = net.trace_intended(pkt)
    actual = net.trace_actual(pkt)
    assert intended == ["A", "B", "C"]
    assert actual == ["A", "D", "C"]
