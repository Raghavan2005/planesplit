from ipaddress import IPv4Network
from typing import Literal, Optional

from planesplit.core.packet import Packet


class Router:
    """A single network node holding two independent forwarding tables.

    RIB (control-plane intent) and FIB (data-plane reality) are plain dicts
    with no relationship to each other in code — the only path from one to
    the other is the Update Channel (faults/update_channel.py). Never add a
    method here that reads self.rib to decide a self.fib value, or the whole
    point of PS31 (independent CP/DP) is silently defeated.
    """

    def __init__(self, router_id: str):
        self.id = router_id
        self.rib: dict[IPv4Network, Optional[str]] = {}
        self.fib: dict[IPv4Network, Optional[str]] = {}

    def forward(self, packet: Packet, table: Literal["rib", "fib"]) -> Optional[str]:
        """Longest-prefix-match lookup. Appends self.id to packet.trace.

        Returns the next-hop router id, or None if either no entry covers
        packet.dst (blackhole) or the matching entry's next hop is None
        (a directly-connected/local-delivery route). Network._trace tells
        these two apart by comparing the final hop against the expected
        destination router, not by anything returned here.
        """
        table_dict = self.rib if table == "rib" else self.fib
        best_next_hop: Optional[str] = None
        best_prefixlen = -1
        for network, next_hop in table_dict.items():
            if packet.dst in network and network.prefixlen > best_prefixlen:
                best_next_hop = next_hop
                best_prefixlen = network.prefixlen
        packet.trace.append(self.id)
        return best_next_hop
