import ipaddress
import typing

class Packet:
    def __init__(self, src_ip: str, dst_ip: str):
        self.src_ip = src_ip
        self.dst_ip = dst_ip
        self.trace = []

class Router:
    def __init__(self, name: str):
        self.name = name
        self.rib = {}
        self.fib = {}

    def add_rib_rule(self, prefix: str, next_hop: str):
        self.rib[prefix] = next_hop

    def add_fib_rule(self, prefix: str, next_hop: str):
        self.fib[prefix] = next_hop

    def drop_fib_rule(self, prefix: str):
        if prefix in self.fib:
            del self.fib[prefix]

    def _lpm(self, table: dict, dst_ip: str):
        ip = ipaddress.ip_address(dst_ip)
        longest_match = None
        max_prefixlen = -1

        for prefix, next_hop in table.items():
            network = ipaddress.ip_network(prefix, strict=False)
            if ip in network:
                if network.prefixlen > max_prefixlen:
                    max_prefixlen = network.prefixlen
                    longest_match = next_hop

        return longest_match

    def expected_next_hop(self, packet: Packet):
        return self._lpm(self.rib, packet.dst_ip)

    def actual_next_hop(self, packet: Packet):
        return self._lpm(self.fib, packet.dst_ip)


class Network:
    def __init__(self):
        self.routers = {}

    def add_router(self, router: Router):
        self.routers[router.name] = router

    def simulate_path(self, packet: Packet, start_router_name: str, use_cp: bool = False):
        current = start_router_name
        visited = set()

        while current is not None:
            if current not in self.routers:
                # Dropped
                packet.trace.append("DROP")
                break

            packet.trace.append(current)
            
            if current in visited:
                packet.trace.append("LOOP")
                break
            visited.add(current)

            router = self.routers[current]
            if use_cp:
                current = router.expected_next_hop(packet)
            else:
                current = router.actual_next_hop(packet)

        return packet.trace
