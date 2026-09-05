# Build Plan — PlaneSplit (PS31)

Pure software simulation. No real network, hardware, or programmable switch required.

## Components

1. **Controller (control plane)**
   Holds the intended forwarding table (destination/flow → next hop), versioned and timestamped per rule change. This is the single source of "intent."

2. **N virtual switches (data plane)**
   Each holds its own locally-applied forwarding table. A switch only updates its table when it actually receives a propagated update message — it never reads the controller's intent directly. This independence is what makes the divergence real rather than assumed.

3. **Update channel simulator**
   Sits between controller and switches. Can inject delay, drop, or partial delivery per update (e.g. 2 of 3 switches receive an update, 1 silently doesn't). This is the mechanism that produces both required demo scenarios.

4. **Packet prober**
   Injects synthetic packets at ingress switches and traces the actual hop-by-hop path using each switch's *real* local table — never the controller's intent — producing the ground-truth "actual path" for a flow.

5. **Verifier**
   Compares the actual path against the controller's current intent, tolerating a declared grace window (e.g. no alarm within N seconds or N heartbeats after a rule change). Once the window has elapsed, a persisting mismatch is flagged with the exact flow, the switch responsible, and expected-vs-actual next hop.

## Required demos

- **Demo A — normal convergence**: push an update, all switches apply it inside the grace window → prober confirms match after the window → no alert.
- **Demo B — injected divergence**: silently drop one switch's update → prober shows the same mismatch persisting past the window → verifier names the exact affected flow → a probe packet demonstrates the real consequence (wrong destination, blackhole, or bypassing a rule meant to block it).

## Stretch goal

Make one injected rule a security ACL (e.g. "block traffic to X"). The demonstrated consequence then becomes a live policy bypass rather than just a routing curiosity — strengthens the pitch with a security angle.

## Stack

- Pure Python (or Node), no external network stack needed.
- Topology as a graph; forwarding tables as dicts (`flow/destination → next_hop`).
- A virtual clock or simple event loop drives timing for the grace window and propagation delay — avoids relying on real wall-clock timing, which de-risks the biggest flagged weakness (fragile timing logic).
- Visualization: a small served HTML/JS page or animated packet trace showing topology, intended vs. actual tables per switch, and the packet's real path — improves live demo impact.

## Open decisions (to confirm before starting scaffolding)
- Language/stack: Python vs Node vs other.
- Number of switches / topology shape for the demo (e.g. 3-5 nodes is likely enough).
- Whether the visualization is a served web page or a CLI/terminal animation.
