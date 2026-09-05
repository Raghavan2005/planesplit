from ipaddress import IPv4Address
from typing import Literal

from planesplit.core.packet import Packet
from planesplit.core.router import Router


class Network:
    """A collection of routers plus the host-to-ingress-router mapping.

    host_attachment is topology setup data (which edge router a given IP is
    directly connected to), not part of the CP/DP split — trace_intended()
    and trace_actual() both use it identically, only the table they walk
    ("rib" vs "fib") differs.
    """

    def __init__(self):
        self.routers: dict[str, Router] = {}
        self.host_attachment: dict[IPv4Address, str] = {}

    def add_router(self, router: Router) -> None:
        self.routers[router.id] = router

    def attach_host(self, host_ip: IPv4Address, router_id: str) -> None:
        self.host_attachment[host_ip] = router_id

    def trace_intended(self, packet: Packet) -> list[str]:
        return self._trace(packet, "rib")

    def trace_actual(self, packet: Packet) -> list[str]:
        return self._trace(packet, "fib")

    def _trace(self, packet: Packet, table: Literal["rib", "fib"], max_hops: int = 16) -> list[str]:
        packet.trace = []
        current = self.host_attachment.get(packet.src)
        if current is None:
            raise ValueError(f"no ingress router known for host {packet.src}")
        visited: set[str] = set()
        while current is not None and current not in visited and len(packet.trace) < max_hops:
            if current not in self.routers:
                break
            visited.add(current)
            router = self.routers[current]
            current = router.forward(packet, table)
        return list(packet.trace)

    def delivered(self, packet: Packet, dst: IPv4Address) -> bool:
        """True if the trace actually ended at dst's attachment router."""
        expected = self.host_attachment.get(dst)
        return bool(packet.trace) and expected is not None and packet.trace[-1] == expected
