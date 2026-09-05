"""Unit tests for control_plane.py, faults/update_channel.py, verify/prober.py (M2).

Same 4-router topology as test_core.py: hostA -> A -> B -> C -> hostC,
with an alternate A -> D -> C path.
"""
from ipaddress import IPv4Address, IPv4Network

from planesplit.core.control_plane import ControlPlaneManager
from planesplit.core.network import Network
from planesplit.core.router import Router
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.prober import boundary_probe_address, probe_flow

HOST_A = IPv4Address("10.0.0.1")
HOST_C = IPv4Address("10.0.2.1")
FLOW = IPv4Network("10.0.2.0/24")


def build_network() -> Network:
    net = Network()
    for rid in ("A", "B", "C", "D"):
        net.add_router(Router(rid))
    net.routers["B"].rib[FLOW] = "C"
    net.routers["B"].fib[FLOW] = "C"
    net.routers["D"].rib[FLOW] = "C"
    net.routers["D"].fib[FLOW] = "C"
    net.routers["C"].rib[FLOW] = None
    net.routers["C"].fib[FLOW] = None
    net.attach_host(HOST_A, "A")
    net.attach_host(HOST_C, "C")
    return net


def test_push_route_writes_rib_immediately_and_never_touches_fib():
    net = build_network()
    cpm = ControlPlaneManager(net)
    update = cpm.push_route(FLOW, "A", "B")
    assert net.routers["A"].rib[FLOW] == "B"
    assert FLOW not in net.routers["A"].fib
    assert update.flow == FLOW and update.router_id == "A" and update.next_hop == "B"


def test_update_channel_none_mode_applies_immediately():
    net = build_network()
    cpm = ControlPlaneManager(net)
    channel = UpdateChannel(net)
    update = cpm.push_route(FLOW, "A", "B")
    channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=0.0)
    assert net.routers["A"].fib[FLOW] == "B"


def test_update_channel_drop_mode_never_applies():
    net = build_network()
    cpm = ControlPlaneManager(net)
    channel = UpdateChannel(net)
    update = cpm.push_route(FLOW, "A", "B")
    channel.apply(update, InjectedFault(mode=FaultMode.DROP), now=0.0)
    channel.tick(now=1000.0)  # even far in the future, a drop never delivers
    assert FLOW not in net.routers["A"].fib


def test_update_channel_delay_mode_applies_only_after_elapsed_time():
    net = build_network()
    cpm = ControlPlaneManager(net)
    channel = UpdateChannel(net)
    update = cpm.push_route(FLOW, "A", "B")
    channel.apply(update, InjectedFault(mode=FaultMode.DELAY, delay_seconds=5.0), now=0.0)

    channel.tick(now=3.0)
    assert FLOW not in net.routers["A"].fib  # not yet due

    channel.tick(now=5.0)
    assert net.routers["A"].fib[FLOW] == "B"  # due now


def test_update_channel_corrupt_mode_writes_a_different_prefix():
    net = build_network()
    cpm = ControlPlaneManager(net)
    channel = UpdateChannel(net)
    update = cpm.push_route(FLOW, "A", "B")
    channel.apply(update, InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1), now=0.0)

    assert FLOW not in net.routers["A"].fib  # the correct /24 was never written
    corrupted = IPv4Network("10.0.2.0/25")
    assert net.routers["A"].fib[corrupted] == "B"


def test_boundary_probe_uses_last_host_address_not_network_address():
    addr = boundary_probe_address(FLOW)
    assert addr == IPv4Address("10.0.2.254")  # last usable host in a /24


def test_boundary_probe_detects_narrowed_corrupt_prefix():
    """A /24 corrupted to /25 still covers .1 but not .254 — probing the
    boundary address is what makes this fault actually observable."""
    net = build_network()
    net.routers["A"].rib[FLOW] = "B"
    net.routers["A"].fib[IPv4Network("10.0.2.0/25")] = "B"  # corrupted FIB entry

    intended, actual = probe_flow(net, FLOW, HOST_A)
    assert intended == ["A", "B", "C"]
    assert actual == ["A"]  # .254 is outside the corrupted /25 -> blackhole at A
