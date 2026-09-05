from ipaddress import IPv4Address, IPv4Network

from planesplit.core.network import Network
from planesplit.core.packet import Packet


def boundary_probe_address(flow: IPv4Network) -> IPv4Address:
    """Pick a destination address at the edge of the flow's prefix.

    A partial-application fault (e.g. /24 corrupted to /25) is invisible to
    a probe aimed at the network's first address, since that address is
    covered by both the correct and the corrupted prefix. Using the last
    usable address instead means a corruption that shrinks the covered
    range is actually exercised by the probe (see docs/VERIFICATION_NOTES.md
    boundary-analysis critique).
    """
    hosts = list(flow.hosts())
    if hosts:
        return hosts[-1]
    return flow.network_address  # /31 or /32: no distinct host range


def probe_flow(network: Network, flow: IPv4Network, src: IPv4Address) -> tuple[list[str], list[str]]:
    """Generate one probe packet for `flow` and trace both CP and DP paths.

    Returns (intended_path, actual_path). Two separate Packet instances are
    used so neither trace can leak into the other regardless of Network's
    internal reset behavior.
    """
    dst = boundary_probe_address(flow)
    intended = network.trace_intended(Packet(src=src, dst=dst))
    actual = network.trace_actual(Packet(src=src, dst=dst))
    return intended, actual
