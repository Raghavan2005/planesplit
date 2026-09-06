"""Tests for backend/state.py — written after manual UI testing found two
real bugs in the old from-scratch backend/network.py implementation:
(1) the corrupt-mask probe used the FIRST host address, which a narrowed
/25 still covers, so corruption was silently undetected; (2) there was no
grace-window concept at all, so every mismatch showed as an immediate
alert. Both are fixed here by reusing the already-tested planesplit engine
instead of reimplementing it.
"""
import pytest

from state import (
    FLOW,
    GRACE_WINDOW_SECONDS,
    MAX_PACKET_SIZE_BYTES,
    MAX_SERVERS,
    MAX_USERS,
    MIN_PACKET_SIZE_BYTES,
    SimulationState,
    validate_packet_size,
)


class FakeClock:
    """Injectable clock so these tests never need a real sleep."""

    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def test_reset_is_fully_synced():
    sim = SimulationState(clock=FakeClock())
    snap = sim.reset()
    assert snap.status == "synced"
    assert snap.cp_trace == snap.dp_trace == ["Users", "Firewall", "Server"]
    assert snap.fault_node is None


def test_drop_is_tolerated_immediately_then_alerts_after_grace_window():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()

    snap = sim.inject("drop")
    assert snap.status == "tolerated"
    assert snap.cp_trace == ["Users", "AWS_ALB", "Server"]
    assert snap.dp_trace == ["Users", "Firewall", "Server"]

    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()
    assert snap.status == "alert"
    assert snap.fault_node == "Users"


def test_corrupt_mask_is_detected_via_boundary_probe():
    """Regression test for the specific false-negative bug found by manually
    clicking through the UI: a /25 corruption still covers the first host
    address of the /24, so probing anywhere but the boundary misses it."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()

    snap = sim.inject("corrupt")
    assert snap.status == "tolerated"  # correct: not yet past the grace window

    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()
    assert snap.status == "alert"
    assert snap.cp_trace != snap.dp_trace


def test_delay_converges_after_the_delay_elapses():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()

    snap = sim.inject("delay")
    assert snap.status == "tolerated"

    clock.advance(GRACE_WINDOW_SECONDS + 2.0)
    snap = sim.tick()
    assert snap.status == "synced"


def test_repeated_actions_do_not_accumulate_stale_fib_entries():
    """Regression test for the 'state carries over between clicks' issue
    found during manual testing: corrupt() writes an extra narrow-prefix
    FIB entry — a following drop() must not leave that stale entry behind
    underneath the new fault."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    sim.inject("corrupt")
    sim.inject("drop")
    assert len(sim.net.routers["Users"].fib) == 1


def test_none_fault_converges_both_planes_immediately():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    snap = sim.inject("none")
    assert snap.status == "synced"
    assert snap.cp_trace == snap.dp_trace


def test_scale_creates_the_requested_number_of_independent_servers():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    snap = sim.scale(num_servers=4, num_users=6)

    assert len(snap.flows) == 4
    assert snap.num_users == 6
    assert snap.flows[0].server_id == "Server"  # server 0 keeps the legacy name
    assert [f.server_id for f in snap.flows[1:]] == ["Server_2", "Server_3", "Server_4"]
    assert all(f.status == "synced" for f in snap.flows)
    assert snap.root_causes == []


def test_scale_clamps_out_of_range_requests():
    sim = SimulationState(clock=FakeClock())
    snap = sim.scale(num_servers=999, num_users=999)
    assert len(snap.flows) == MAX_SERVERS
    assert snap.num_users == MAX_USERS

    snap = sim.scale(num_servers=0, num_users=0)
    assert len(snap.flows) == 1
    assert snap.num_users == 1


def test_scale_then_reset_returns_to_the_single_flow_baseline():
    sim = SimulationState(clock=FakeClock())
    sim.scale(num_servers=4, num_users=6)
    snap = sim.reset()
    assert len(snap.flows) == 1
    assert snap.num_users == 1
    assert snap.cp_trace == snap.dp_trace == ["Users", "Firewall", "Server"]


def test_scaled_fault_on_shared_ingress_correlates_across_every_server():
    """The same fault applied at Users (the shared ingress) breaks every
    backend server behind it identically -- correlate() (already tested in
    planesplit/tests/test_correlator.py) should group all of them under one
    shared root cause, not report N unrelated-looking alerts."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(num_servers=3, num_users=3)

    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()

    assert all(f.status == "alert" for f in snap.flows)
    assert all(f.fault_node == "Users" for f in snap.flows)
    assert len(snap.root_causes) == 1
    assert snap.root_causes[0]["responsible_router"] == "Users"
    assert len(snap.root_causes[0]["flows"]) == 3


def test_scaled_servers_have_independent_grace_windows_like_unscaled_flows():
    """Mirrors planesplit's own Scenario 5 guarantee (independent per-flow
    grace windows) at the backend-state level: injecting a fault only
    affects flows present at the time of injection, not ones added after."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(num_servers=2, num_users=2)
    sim.inject("drop")

    # Scaling up mid-fault rebuilds the whole network fresh (matching
    # reset()'s semantics) -- the new, larger topology starts fully
    # converged, it doesn't inherit the prior fault.
    snap = sim.scale(num_servers=3, num_users=3)
    assert all(f.status == "synced" for f in snap.flows)


def test_validate_packet_size_accepts_the_full_valid_ethernet_range():
    assert validate_packet_size(MIN_PACKET_SIZE_BYTES) == MIN_PACKET_SIZE_BYTES
    assert validate_packet_size(MAX_PACKET_SIZE_BYTES) == MAX_PACKET_SIZE_BYTES
    assert validate_packet_size(800) == 800


@pytest.mark.parametrize("bad_size", [
    MIN_PACKET_SIZE_BYTES - 1,
    MAX_PACKET_SIZE_BYTES + 1,
    0,
    -64,
])
def test_validate_packet_size_rejects_out_of_range_sizes(bad_size):
    with pytest.raises(ValueError, match="outside the valid Ethernet"):
        validate_packet_size(bad_size)


@pytest.mark.parametrize("bad_size", [64.5, "64", None, True])
def test_validate_packet_size_rejects_non_int_input(bad_size):
    with pytest.raises(ValueError, match="must be an int"):
        validate_packet_size(bad_size)


def test_every_snapshot_flow_carries_a_valid_packet_size():
    """Every packet_size_bytes this module ever produces must itself pass
    validate_packet_size -- generation and validation are checked
    independently so a future change to the generator can't silently drift
    outside the bound it's supposed to respect."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    snap = sim.scale(num_servers=3, num_users=3)
    for f in snap.flows:
        assert validate_packet_size(f.packet_size_bytes) == f.packet_size_bytes


def test_packet_size_is_deterministic_for_the_same_clock_but_varies_over_time():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    snap_a = sim.snapshot()
    snap_b = sim.snapshot()
    assert snap_a.flows[0].packet_size_bytes == snap_b.flows[0].packet_size_bytes  # same `now` -> same size

    clock.advance(5.0)
    snap_c = sim.snapshot()
    # Not a hard guarantee for every possible pair (the hash could coincide),
    # but with a 1437-value range a same-flow collision across a real time
    # jump would be a red flag that the generator isn't actually varying.
    assert snap_a.flows[0].packet_size_bytes != snap_c.flows[0].packet_size_bytes


def test_scale_grace_window_is_configurable():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(1, 1, grace_window_seconds=5.0)

    sim.inject("drop")
    clock.advance(3.0)
    snap = sim.tick()
    assert snap.status == "tolerated"

    clock.advance(2.1)  # total 5.1s since the legitimate change
    snap = sim.tick()
    assert snap.status == "alert"


def test_delay_fault_uses_the_configured_grace_window_not_a_fixed_constant():
    """Regression test: the 'delay' fault's duration must scale with the
    instance's own grace_window_seconds, not a fixed module constant --
    otherwise a configured grace window larger than the old fixed ~3s delay
    converges long before the grace window ever elapses, so the flow never
    reaches 'alert' and the delay-fault demo silently breaks."""
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(1, 1, grace_window_seconds=8.0)

    snap = sim.inject("delay")
    assert snap.status == "tolerated"

    clock.advance(8.1)  # past the configured 8s grace window
    snap = sim.tick()
    assert snap.status == "alert"

    clock.advance(1.5)  # past grace_window(8.0) + delay margin(1.0) = 9.0s total
    snap = sim.tick()
    assert snap.status == "synced"


def test_scale_packet_size_range_is_configurable():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(1, 1, min_packet_size=200, max_packet_size=300)

    for t in (0.0, 1.0, 2.0, 3.0, 4.0):
        clock.t = t
        snap = sim.snapshot()
        size = snap.flows[0].packet_size_bytes
        assert 200 <= size <= 300


def test_scale_packet_size_range_swapped_if_inverted():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    snap = sim.scale(1, 1, min_packet_size=300, max_packet_size=200)
    size = snap.flows[0].packet_size_bytes
    assert 200 <= size <= 300


def test_inject_with_target_server_id_only_faults_that_server():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(3, 1)

    sim.inject("drop", target_server_id="Server_2")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()

    by_id = {f.server_id: f for f in snap.flows}
    assert by_id["Server_2"].status == "alert"
    assert by_id["Server"].status == "synced"
    assert by_id["Server_3"].status == "synced"


def test_inject_with_unknown_target_server_id_raises_value_error():
    """Matches remediate()/send_request()'s existing convention: a stale
    target_server_id (e.g. from before scale() shrank the roster) must
    surface as a real error, not silently fault every flow instead of the
    one intended."""
    sim = SimulationState(clock=FakeClock())
    sim.scale(2, 1)

    with pytest.raises(ValueError, match="unknown target_server_id"):
        sim.inject("drop", target_server_id="NoSuchServer")


def test_remediate_fixes_an_alerted_flow_and_reconverges():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()

    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()
    assert snap.status == "alert"

    snap = sim.remediate("Server")
    assert snap.status == "synced"
    assert snap.cp_trace == snap.dp_trace


def test_remediate_raises_value_error_when_server_has_no_active_alert():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    with pytest.raises(ValueError, match="no active alert"):
        sim.remediate("Server")


def test_remediate_raises_value_error_for_unknown_server_id():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    with pytest.raises(ValueError, match="no active alert"):
        sim.remediate("NoSuchServer")


def test_remediate_does_not_disturb_other_scaled_servers():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.scale(3, 1)

    sim.inject("drop", target_server_id="Server_2")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()
    assert snap.flows[1].status == "alert"

    snap = sim.remediate("Server_2")
    by_id = {f.server_id: f for f in snap.flows}
    assert by_id["Server_2"].status == "synced"
    assert by_id["Server"].status == "synced"
    assert by_id["Server_3"].status == "synced"


def test_snapshot_includes_detected_at_for_alerted_flow_only():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    snap = sim.snapshot()
    assert snap.flows[0].detected_at is None  # synced -- no alert yet

    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    snap = sim.tick()
    assert snap.flows[0].status == "alert"
    assert snap.flows[0].detected_at == clock.t


def test_rescaling_clears_stale_alerts_so_remediate_then_raises():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    sim.tick()

    sim.scale(2, 2)  # fresh topology, fully converged
    with pytest.raises(ValueError, match="no active alert"):
        sim.remediate("Server")


def test_send_request_on_a_healthy_flow_is_delivered():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    event = sim.send_request("Server")
    assert event.status == "delivered"
    assert event.cp_trace == event.dp_trace == ["Users", "Firewall", "Server"]
    assert event.reason is None
    assert event.server_id == "Server"
    assert event.flow == str(FLOW)


def test_send_request_on_a_currently_alerted_flow_is_diverged_with_a_reason():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    sim.tick()

    event = sim.send_request("Server")
    assert event.status == "diverged"
    assert event.reason is not None
    assert event.cp_trace != event.dp_trace


def test_send_request_reports_dropped_when_the_packet_has_no_route_at_all():
    """inject()'s existing fault modes (drop/corrupt/delay) never produce a
    genuine non-delivery in this topology -- every fault still resolves
    through one of the two always-valid gateways to the same server, so
    this constructs a real black-hole directly to prove send_request's
    delivered/dropped branch (as opposed to the diverged/alert branch)
    works correctly."""
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    del sim.net.routers["Users"].fib[FLOW]

    event = sim.send_request("Server")
    assert event.status == "dropped"
    assert event.reason is None  # still within the grace window -- no Alert
    assert event.dp_trace == ["Users"]


def test_send_request_raises_value_error_for_unknown_server_id():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    with pytest.raises(ValueError, match="unknown server_id"):
        sim.send_request("NoSuchServer")


def test_send_request_log_caps_at_fifty_entries():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    for _ in range(60):
        sim.send_request("Server")
    assert len(sim._request_log) == 50


def test_send_request_log_clears_on_rescale():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    sim.send_request("Server")
    assert len(sim._request_log) == 1
    sim.scale(2, 2)
    assert sim._request_log == []


def test_snapshot_to_dict_includes_recent_requests():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    assert sim.snapshot().to_dict()["recent_requests"] == []

    event = sim.send_request("Server")
    snap_dict = sim.snapshot().to_dict()
    assert snap_dict["recent_requests"] == [event.to_dict()]


def test_snapshot_recent_requests_caps_at_twenty_even_with_a_larger_log():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    for _ in range(30):
        sim.send_request("Server")
    snap_dict = sim.snapshot().to_dict()
    assert len(snap_dict["recent_requests"]) == 20
    # most recent last, matching self._request_log's own append order
    assert snap_dict["recent_requests"][-1]["id"] == sim._request_log[-1].id
