# Research: Control-Plane and Data-Plane Divergence

## 1. Core Concepts
Divergence occurs when the control plane (the decision-making layer generating intended routes) and the data plane (the hardware or state actually forwarding packets) become out of sync. During this state, the network's reality does not match the administrator's or controller's intent.

## 2. Root Causes of Divergence
- **Propagation Delay & Latency:** In distributed systems, updating data plane elements across a network takes time. Congestion or controller latency can cause updates to arrive at different times.
- **Communication Failures:** Packet loss or broken control links (e.g., Southbound APIs in SDN) can prevent a device from receiving the latest routing tables, stranding it with stale instructions.
- **Software & Hardware Faults:** Control planes can get bottlenecked by calculations. Data planes might experience memory exhaustion (e.g., TCAM or FIB table full), causing them to silently fail to apply new rules.
- **Concurrency & Ordering Issues:** Pushing updates to a distributed fleet can result in race conditions, partially applied updates, or out-of-order execution.

## 3. Practical Consequences
- **Routing Loops:** Packets bounce infinitely between routers that have inconsistent topological views (e.g., A thinks B is the next hop, B thinks A is the next hop).
- **Traffic Blackholing:** Traffic is sent to dead ends or dropped because the data plane is following outdated topology rules (e.g., routing to a port that went down).
- **Policy & Security Violations:** Partially applied updates can lead to security gaps (e.g., an "allow" rule is applied, but the corresponding "deny" rule fails).

## 4. Tolerating Propagation Windows
Networks tolerate transient inconsistencies through:
- **Make-Before-Break (MBB):** Establishing a new configuration or path before dismantling the old one.
- **Two-Phase Commit (2PC):** Devices reach consensus before committing to the new state, increasing coordination overhead but ensuring atomicity.
- **Ordered Updates:** Controllers sequence updates carefully (e.g., updating downstream nodes before upstream nodes) to prevent blackholes.

## 5. Convergence Standards
- **Traditional IGP (OSPF):** Converges in milliseconds to a few seconds.
- **BGP:** Can take seconds to minutes.
- **Failover SLA standard:** Typical telecom networks aim for < 50ms recovery time.
