from dataclasses import dataclass, field
from enum import Enum
from ipaddress import IPv4Network
from typing import Optional

from planesplit.core.control_plane import RouteUpdate
from planesplit.core.network import Network


class FaultMode(Enum):
    NONE = "none"
    DELAY = "delay"
    DROP = "drop"
    CORRUPT = "corrupt"


@dataclass
class InjectedFault:
    mode: FaultMode = FaultMode.NONE
    delay_seconds: float = 0.0
    # e.g. +1 turns a /24 into a /25 (narrower — undershoots real coverage);
    # -1 turns a /24 into a /23 (wider — overshoots). Either way the FIB ends
    # up with a network object that does not equal the RIB's intended one.
    corrupt_prefixlen_delta: int = 1


class UpdateChannel:
    """The single point through which every FIB write must pass.

    Nothing outside this class is permitted to fake or shortcut a RIB/FIB
    mismatch — that invariant is the entire point of PS31 (see CLAUDE.md
    project-context section). Timing is driven by an explicit `now` float
    passed in by the caller, never a wall clock (R13).
    """

    GRACE_WINDOW_SECONDS: float = 2.0

    def __init__(self, network: Network):
        self.network = network
        self._pending: list[tuple[float, RouteUpdate]] = []  # (apply_at, update)

    def apply(self, update: RouteUpdate, fault: InjectedFault, now: float) -> None:
        if fault.mode == FaultMode.DROP:
            return  # silent failure: FIB never updated
        if fault.mode == FaultMode.DELAY:
            self._pending.append((now + fault.delay_seconds, update))
            return
        if fault.mode == FaultMode.CORRUPT:
            corrupted = self._corrupt(update.flow, fault.corrupt_prefixlen_delta)
            self.network.routers[update.router_id].fib[corrupted] = update.next_hop
            return
        self.network.routers[update.router_id].fib[update.flow] = update.next_hop

    def tick(self, now: float) -> None:
        """Apply any delayed updates whose delay has elapsed by `now`.

        Must be driven explicitly by the scenario's virtual-clock loop —
        this class never schedules its own wakeups.
        """
        still_pending: list[tuple[float, RouteUpdate]] = []
        for apply_at, update in self._pending:
            if now >= apply_at:
                self.network.routers[update.router_id].fib[update.flow] = update.next_hop
            else:
                still_pending.append((apply_at, update))
        self._pending = still_pending

    @staticmethod
    def _corrupt(flow: IPv4Network, prefixlen_delta: int) -> IPv4Network:
        new_len = max(0, min(32, flow.prefixlen + prefixlen_delta))
        return IPv4Network(f"{flow.network_address}/{new_len}", strict=False)
