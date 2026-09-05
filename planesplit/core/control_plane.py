from dataclasses import dataclass
from ipaddress import IPv4Network
from typing import Optional

from planesplit.core.network import Network


@dataclass
class RouteUpdate:
    flow: IPv4Network
    router_id: str
    next_hop: Optional[str]


class ControlPlaneManager:
    """Computes/pushes control-plane intent. Writes RIB only — a FIB write

    only ever happens through faults.update_channel.UpdateChannel.apply(),
    driven by whoever calls push_route() (a scenario or the CLI demo), which
    receives the RouteUpdate back and is responsible for handing it to the
    channel with an explicit fault mode and virtual-clock `now`.
    """

    def __init__(self, network: Network):
        self.network = network

    def push_route(self, flow: IPv4Network, router_id: str, next_hop: Optional[str]) -> RouteUpdate:
        router = self.network.routers[router_id]
        router.rib[flow] = next_hop  # immediate, reliable — RIB is never faulted
        return RouteUpdate(flow=flow, router_id=router_id, next_hop=next_hop)
