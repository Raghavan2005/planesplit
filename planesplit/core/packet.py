from dataclasses import dataclass, field
from ipaddress import IPv4Address


@dataclass
class Packet:
    src: IPv4Address
    dst: IPv4Address
    trace: list[str] = field(default_factory=list)
