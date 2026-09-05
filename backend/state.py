"""Simulation state for the 3D demo backend.

Deliberately framework-independent (no FastAPI/WebSocket imports) so it's
directly unit-testable without spinning up a live server, per CLAUDE.md
Section16 (domain logic must be testable without the UI).

Reuses the tested planesplit engine instead of reimplementing RIB/FIB/
probing/verification logic a second time — that reimplementation
(backend/network.py, now removed) had two real, silently-wrong bugs found
by manually testing the UI: the corrupt-prefix probe used the FIRST host
address (still covered by a narrowed /25, so corruption was never
detected), and there was no grace-window concept at all (every mismatch
showed as an immediate alert, even a normal propagation delay).

Unlike planesplit's CLI/test suite, this IS allowed to use a real wall
clock (`time.time` by default) — R13's determinism requirement is about
the automated, byte-for-byte-repeatable test suite, not a live,
human-driven interactive demo where wall-clock timing is the whole point
of watching "Inject Delay" resolve. The clock is still injectable (see
`clock` param) so this class can be unit-tested without real sleeps.

Scaling (scale()) generalizes the original single-flow demo to N backend
servers behind the same shared Firewall/AWS_ALB tier, reusing
verify.correlator.correlate() to group any resulting alerts by shared
responsible_router — the same real, tested logic planesplit's CLI demo
uses, not a new algorithm invented for this UI. num_servers==1 (the
default) is kept byte-identical to the pre-scaling topology/naming so the
existing single-flow tests below need no changes.
"""
import hashlib
import time
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv4Network
from typing import Callable, Optional

from planesplit.core.control_plane import ControlPlaneManager
from planesplit.core.network import Network
from planesplit.core.router import Router
from planesplit.faults.update_channel import FaultMode, InjectedFault, UpdateChannel
from planesplit.verify.correlator import correlate
from planesplit.verify.prober import probe_flow
from planesplit.verify.remediator import Remediator
from planesplit.verify.verifier import Alert, Verifier

# Kept as module-level constants for backward compatibility: these describe
# exactly the first/default server and its flow, unchanged from before
# scale() existed, so num_servers=1 always reproduces the original topology.
HOST = IPv4Address("10.0.0.1")
DST = IPv4Address("10.0.1.1")
FLOW = IPv4Network("10.0.1.0/24")
ROUTERS = ["Users", "Firewall", "Server", "AWS_ALB"]
GRACE_WINDOW_SECONDS = UpdateChannel.GRACE_WINDOW_SECONDS  # same constant as the core engine, 2.0

# No arbitrary business cap here — MIN is a real correctness requirement
# (snapshot() needs at least one attached user to probe from, and at least
# one server to have a flow at all). MAX is the actual technical ceiling of
# the addressing scheme below (each server/user beyond the first gets its
# own IPv4 octet value, 1-254; 0 and 255 are reserved/broadcast), not a
# chosen "keep the demo tidy" number — going higher would need a different
# addressing scheme (e.g. spanning two octets), which is real extra work,
# not just a constant to change.
MIN_SERVERS, MAX_SERVERS = 1, 254
MIN_USERS, MAX_USERS = 1, 254

_FAULT_MAP = {
    "none": lambda: InjectedFault(mode=FaultMode.NONE),
    "delay": lambda: InjectedFault(mode=FaultMode.DELAY, delay_seconds=GRACE_WINDOW_SECONDS + 1.0),
    "drop": lambda: InjectedFault(mode=FaultMode.DROP),
    "corrupt": lambda: InjectedFault(mode=FaultMode.CORRUPT, corrupt_prefixlen_delta=1),
}

# Real, citable constraint (IEEE 802.3), not an arbitrary number: a
# standard untagged Ethernet II frame must be between 64 bytes (the
# historical minimum for reliable collision detection) and 1500 bytes (the
# standard MTU; jumbo frames go higher but aren't "standard"). Every
# simulated packet's size is generated within this range and re-validated
# against it before being attached to a snapshot.
MIN_PACKET_SIZE_BYTES = 64
MAX_PACKET_SIZE_BYTES = 1500


def validate_packet_size(size_bytes: int) -> int:
    """Raise ValueError if size_bytes isn't a valid standard-Ethernet-frame
    size. Applied to every generated packet size below — a value this
    module produces itself should never be able to silently violate a real
    physical constraint, the same defensive posture CLAUDE.md SS11 asks for
    at any boundary, including ones we control ourselves.
    """
    if not isinstance(size_bytes, int) or isinstance(size_bytes, bool):
        raise ValueError(f"packet size must be an int, got {type(size_bytes).__name__}")
    if not (MIN_PACKET_SIZE_BYTES <= size_bytes <= MAX_PACKET_SIZE_BYTES):
        raise ValueError(
            f"packet size {size_bytes} bytes is outside the valid Ethernet "
            f"frame range [{MIN_PACKET_SIZE_BYTES}, {MAX_PACKET_SIZE_BYTES}]"
        )
    return size_bytes


def _packet_size_for(flow: IPv4Network, now: float, min_bytes: int, max_bytes: int) -> int:
    """Deterministic given (flow, now) — same inputs always produce the same
    size, so tests using FakeClock stay reproducible — but varies across
    flows and across time so the live demo doesn't show a suspiciously
    identical number on every packet. Uses hashlib rather than Python's
    built-in hash() because str hashing is randomized per-process
    (PYTHONHASHSEED) since Python 3.3 — hashlib gives the same digest
    regardless of process, which a "same inputs, same output" contract
    should not depend on incidentally holding true only within one run.
    """
    digest = hashlib.sha256(f"{flow}:{now:.1f}".encode()).digest()
    span = max_bytes - min_bytes
    size = min_bytes + (int.from_bytes(digest[:4], "big") % (span + 1))
    return validate_packet_size(size)


@dataclass
class FlowSnapshot:
    server_id: str
    flow: str
    cp_trace: list[str]
    dp_trace: list[str]
    status: str  # "synced" | "tolerated" | "alert"
    fault_node: Optional[str]
    reason: Optional[str]
    packet_size_bytes: int

    def to_dict(self) -> dict:
        return {
            "server_id": self.server_id,
            "flow": self.flow,
            "cp_trace": self.cp_trace,
            "dp_trace": self.dp_trace,
            "status": self.status,
            "fault_node": self.fault_node,
            "reason": self.reason,
            "packet_size_bytes": self.packet_size_bytes,
        }


@dataclass
class Snapshot:
    flows: list[FlowSnapshot]
    root_causes: list[dict]
    num_users: int

    # Backward-compatible single-flow view, always mirroring flows[0] (the
    # "Server"/FLOW leg). Every action this backend supported before
    # multi-server scaling only ever had one flow, so code written against
    # these top-level fields (including the tests below) keeps seeing
    # exactly what it did before scale() existed.
    @property
    def cp_trace(self) -> list[str]:
        return self.flows[0].cp_trace

    @property
    def dp_trace(self) -> list[str]:
        return self.flows[0].dp_trace

    @property
    def status(self) -> str:
        return self.flows[0].status

    @property
    def fault_node(self) -> Optional[str]:
        return self.flows[0].fault_node

    @property
    def reason(self) -> Optional[str]:
        return self.flows[0].reason

    def to_dict(self) -> dict:
        return {
            "type": "state",
            "cp_trace": self.cp_trace,
            "dp_trace": self.dp_trace,
            "status": self.status,
            "fault_node": self.fault_node,
            "reason": self.reason,
            "flows": [f.to_dict() for f in self.flows],
            "root_causes": self.root_causes,
            "num_users": self.num_users,
        }


class SimulationState:
    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self.reset()

    def reset(self) -> Snapshot:
        return self.scale(num_servers=1, num_users=1,
                           grace_window_seconds=UpdateChannel.GRACE_WINDOW_SECONDS,
                           min_packet_size=MIN_PACKET_SIZE_BYTES,
                           max_packet_size=MAX_PACKET_SIZE_BYTES)

    def scale(self, num_servers: int, num_users: int,
              grace_window_seconds: Optional[float] = None,
              min_packet_size: Optional[int] = None,
              max_packet_size: Optional[int] = None) -> Snapshot:
        """Rebuild the network with `num_servers` backend servers sharing
        the same Users/Firewall/AWS_ALB ingress tier, and `num_users`
        synthetic client hosts attached to it. Routing is destination-based
        (per planesplit.core.router.Router.forward's LPM), so every
        attached user follows the same computed path for a given flow —
        `num_users` genuinely adds that many attached hosts (not just a
        cosmetic counter), but their shared ingress means they don't need
        individually-tracked routes to demonstrate "many real users hitting
        a shared load balancer/firewall tier", which is the real-infra
        picture being modeled here.

        grace_window_seconds/min_packet_size/max_packet_size are optional
        demo-tuning knobs for the live dashboard — None (the default, used
        by every pre-existing caller) reproduces today's exact behavior.
        """
        num_servers = max(MIN_SERVERS, min(MAX_SERVERS, num_servers))
        num_users = max(MIN_USERS, min(MAX_USERS, num_users))

        if grace_window_seconds is None:
            grace_window_seconds = UpdateChannel.GRACE_WINDOW_SECONDS
        else:
            # [1.0, 10.0] is a UX/demo-usability bound, not a physical
            # constraint: the backend's own broadcast tick runs every 0.3s
            # (see start_tick_loop in main.py), so a window any shorter than
            # ~1s would make the TOLERATED state flicker past too fast to be
            # visible in the live UI between broadcasts.
            grace_window_seconds = max(1.0, min(10.0, grace_window_seconds))

        if min_packet_size is None:
            min_packet_size = MIN_PACKET_SIZE_BYTES
        else:
            min_packet_size = max(MIN_PACKET_SIZE_BYTES, min(MAX_PACKET_SIZE_BYTES, min_packet_size))
        if max_packet_size is None:
            max_packet_size = MAX_PACKET_SIZE_BYTES
        else:
            max_packet_size = max(MIN_PACKET_SIZE_BYTES, min(MAX_PACKET_SIZE_BYTES, max_packet_size))
        if min_packet_size > max_packet_size:
            # A UX input, not the hard Ethernet-frame guarantee
            # validate_packet_size enforces elsewhere in this file -- a
            # reversed range from the dashboard is just swapped into a
            # valid one rather than rejected.
            min_packet_size, max_packet_size = max_packet_size, min_packet_size

        self.grace_window_seconds = grace_window_seconds
        self.min_packet_size = min_packet_size
        self.max_packet_size = max_packet_size

        self.net = Network()
        for name in ("Users", "Firewall", "AWS_ALB"):
            self.net.add_router(Router(name))

        # Server 0 keeps the exact legacy name/flow ("Server", 10.0.1.0/24)
        # so num_servers=1 is byte-identical to the pre-scaling topology.
        self.server_ids = ["Server"] + [f"Server_{i + 2}" for i in range(num_servers - 1)]
        self.flows = [FLOW] + [IPv4Network(f"10.0.{i + 2}.0/24") for i in range(num_servers - 1)]

        for server_id, flow in zip(self.server_ids, self.flows):
            self.net.add_router(Router(server_id))
            self.net.routers["Firewall"].rib[flow] = server_id
            self.net.routers["Firewall"].fib[flow] = server_id
            self.net.routers["AWS_ALB"].rib[flow] = server_id
            self.net.routers["AWS_ALB"].fib[flow] = server_id
            self.net.routers[server_id].rib[flow] = None
            self.net.routers[server_id].fib[flow] = None
            dst_ip = next(flow.hosts())
            self.net.attach_host(dst_ip, server_id)

        self.user_ips = [HOST] + [IPv4Address(f"10.0.0.{i + 2}") for i in range(num_users - 1)]
        for user_ip in self.user_ips:
            self.net.attach_host(user_ip, "Users")

        self.cpm = ControlPlaneManager(self.net)
        self.channel = UpdateChannel(self.net)
        self.verifier = Verifier(grace_window_seconds=self.grace_window_seconds)
        # snapshot() (called at the end of this method) rebuilds this fresh
        # every time, so a rescale can never leave remediate() pointing at
        # an Alert whose flow/router no longer exists in the new topology.
        self._alerts_by_server: dict[str, Alert] = {}

        # Baseline: every flow starts Users -> Firewall, fully converged.
        now = self._clock()
        for flow in self.flows:
            update = self.cpm.push_route(flow, "Users", "Firewall")
            self.channel.apply(update, InjectedFault(mode=FaultMode.NONE), now=now)
            self.verifier.push_legitimate_change(flow, now=now)

        return self.snapshot()

    def inject(self, fault_name: str, target_server_id: Optional[str] = None) -> Snapshot:
        """Push a fresh legitimate route change on every flow's Users->?
        leg simultaneously, toggling each between Firewall and AWS_ALB, then
        apply the SAME requested fault to every flow's FIB write. Applying
        one fault to every flow at once (rather than picking just one) is
        deliberate: it reproduces the exact multi-flow-shared-root-cause
        shape verify.correlator.correlate() exists for — a real shared
        ingress/LB problem affecting every backend behind it — instead of
        a scenario that never actually needs correlation.

        target_server_id optionally restricts the fault to a single
        server's flow (for the multi-flow root-cause demo where only one
        backend actually breaks). None (the default) keeps today's
        all-flows behavior. If target_server_id doesn't match any current
        server (e.g. a stale selection from before scale() shrank the
        roster), fall back to faulting all flows rather than silently
        doing nothing.
        """
        now = self._clock()
        fault = _FAULT_MAP.get(fault_name, _FAULT_MAP["none"])()

        if target_server_id is None:
            flows_to_fault = self.flows
        else:
            flows_to_fault = [
                flow for sid, flow in zip(self.server_ids, self.flows)
                if sid == target_server_id
            ]
        if not flows_to_fault:
            flows_to_fault = self.flows

        for flow in flows_to_fault:
            current_next_hop = self.net.routers["Users"].rib.get(flow)

            # Re-converge first: clear any leftover FIB entries a previous
            # CORRUPT click left behind for THIS flow specifically (a
            # narrower prefix sharing the same network address) — matching
            # by network_address rather than clearing the whole table keeps
            # this safe now that "Users".fib holds entries for multiple
            # independent flows at once.
            stale_keys = [
                k for k in list(self.net.routers["Users"].fib.keys())
                if k.network_address == flow.network_address
            ]
            for k in stale_keys:
                del self.net.routers["Users"].fib[k]
            if current_next_hop is not None:
                self.net.routers["Users"].fib[flow] = current_next_hop

            new_next_hop = "AWS_ALB" if current_next_hop != "AWS_ALB" else "Firewall"
            update = self.cpm.push_route(flow, "Users", new_next_hop)
            self.verifier.push_legitimate_change(flow, now=now)
            self.channel.apply(update, fault, now=now)

        return self.snapshot()

    def remediate(self, server_id: str) -> Snapshot:
        """Fix server_id's current real Alert by replaying its RIB's own
        never-faulted intent through one clean UpdateChannel write — a real
        corrective action via the tested Remediator, not an optimistic UI
        flip. Raises ValueError if server_id has no active alert right now
        (already synced/tolerated, or an unknown id), so a stale click from
        the UI surfaces as a real error rather than silently no-op'ing.
        """
        alert = self._alerts_by_server.get(server_id)
        if alert is None:
            raise ValueError(
                f"no active alert for server_id {server_id!r} to remediate "
                "(it may already be synced, or the id may be unknown)"
            )
        Remediator(self.net, self.cpm, self.channel, self.verifier).remediate(
            alert, now=self._clock()
        )
        return self.snapshot()

    def tick(self) -> Snapshot:
        """Apply any due delayed updates and re-evaluate. Called by the
        backend's periodic broadcast loop so a TOLERATED mismatch can be
        seen transitioning to ALERT (or to synced, for a DELAY fault) purely
        from the passage of real time, with no new user action."""
        self.channel.tick(self._clock())
        return self.snapshot()

    def snapshot(self) -> Snapshot:
        now = self._clock()
        flow_snapshots: list[FlowSnapshot] = []
        alerts = []
        # Rebuilt fresh every call — a server whose flow re-converges (or
        # was rescaled away) must not leave a stale Alert remediate() could
        # act on.
        self._alerts_by_server = {}

        # Any attached user works as the probe source — routing is
        # destination-based, so the computed path is identical regardless
        # of which attached user "sends" the probe.
        probe_host = self.user_ips[0]

        for server_id, flow in zip(self.server_ids, self.flows):
            intended, actual = probe_flow(self.net, flow, probe_host)
            alert = self.verifier.check(flow, intended, actual, now=now)
            if alert is not None:
                status = "alert"
                alerts.append(alert)
                self._alerts_by_server[server_id] = alert
            elif intended != actual:
                status = "tolerated"
            else:
                status = "synced"
            flow_snapshots.append(FlowSnapshot(
                server_id=server_id,
                flow=str(flow),
                cp_trace=intended,
                dp_trace=actual,
                status=status,
                fault_node=alert.responsible_router if alert else None,
                reason=alert.reason if alert else None,
                packet_size_bytes=_packet_size_for(flow, now, self.min_packet_size, self.max_packet_size),
            ))

        root_causes = [
            {"responsible_router": r.responsible_router, "flows": [str(f) for f in r.flows]}
            for r in correlate(alerts)
            if r.is_correlated
        ]

        return Snapshot(flows=flow_snapshots, root_causes=root_causes, num_users=len(self.user_ips))
