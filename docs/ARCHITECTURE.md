# System Architecture

## 1. Overview
The solution is a pure software model built in Python. It avoids physical hardware or programmable switches, simulating a network graph where control-plane intent and data-plane state are distinctly separated and evaluated via active, simulated packet probing.

## 2. Core Components

### A. The Network Node (`Router`)
Each node in our simulated network contains two distinct state tables:
- **`RIB` (Routing Information Base):** Represents the Control Plane. This is the intended state pushed by our central controller.
- **`FIB` (Forwarding Information Base):** Represents the Data Plane. This is the actual execution state used to route packets.

### B. The Control Plane Manager
A centralized coordinator that computes routes and pushes them to the `RIB` of every node. This push is reliable and effectively instant — the RIB is the local mirror of "current intent," so the aggregate of all RIBs *is* the declared control-plane state. The manager does not touch any `FIB` directly; every FIB update is queued to the Update Channel instead.

### B2. The Update Channel (Fault Injector)
The single point through which every `FIB` update must pass on its way from the Control Plane Manager to a node. This is the *only* place divergence is allowed to originate — nothing else in the system is permitted to fake or shortcut a mismatch. Per router and per update, it can apply:
- **Delay** — the update is applied to the FIB after `X` seconds.
- **Drop** — the update never reaches the FIB (silent failure).
- **Corruption / partial application** — the update is applied but altered (e.g. a `/24` prefix written as `/25`), or applied to only a subset of the affected routers.

A router forwards using its FIB only, and never reads its own or any other node's RIB — that independence is what makes a detected divergence real rather than assumed.

### C. The Packet Simulator
Instead of physical pings, we use a `Packet` object containing:
- Source IP
- Destination IP
- `trace`: A list recording the sequence of nodes visited.
When a packet enters a Node, the Node performs a Longest Prefix Match (LPM) on its `FIB` and forwards the packet to the next hop.

### D. The Consistency Verifier (Prober)
The verifier works by:
1. Computing the **Intended Path** by simulating the packet traversing the `RIB`s (Control Plane).
2. Computing the **Actual Path** by simulating the packet traversing the `FIB`s (Data Plane).
3. Comparing the resulting traces. If they diverge, checking whether the affected flow/destination is still inside its declared **grace window** — the tolerance period measured from the timestamp of the last legitimate RIB change for that flow. Inside the window, a mismatch is expected and suppressed (no alert). Once the window has elapsed, a persisting mismatch is flagged with the exact flow/destination, the responsible router, and the expected-vs-actual next hop.

The verifier tracks grace-window state **per flow/destination**, not globally — each route change starts its own window, so an old, already-expired divergence on one flow never masks or gets confused with a fresh, still-tolerated change on another.

**Default grace-window value: `GRACE_WINDOW_SECONDS = 2.0`** (defined once, in `faults/update_channel.py`, imported wherever needed — never re-typed as a magic number). This is the same value used consistently throughout `TEST_PLAN.md`'s examples; declaring it as a named constant here closes the gap `REQUIREMENTS.md` had previously flagged as open.

## 3. Technology Stack
- **Language:** Python 3.x
- **Libraries:** Built-in `ipaddress` for subnet math and longest prefix matching. No heavy external dependencies required for the core logic, keeping the model lightweight and fast.

## 4. Visualization / Demo Medium

**Decision: CLI-first, required.** The core deliverable is a deterministic, colorized terminal output (e.g. via the `rich` library) showing per-probe PASS/FAIL, the intended vs. actual path, and the verifier's alert with affected flow/router. This is lower-risk than a served web app for a live hackathon demo — no server process that can crash mid-presentation, no browser dependency, and it matches CLAUDE.md's stated priority order (reliability over polish).

A served web visualization (topology + animated packet path) is an explicit **stretch goal only**, attempted after the CLI demo is fully working and tested — never a substitute for it.


## 360° Jury View & Agent Comments
> **Technologist Jury Comment:** Ensure you explicitly document *why* this pure algorithmic approach is superior to using virtualized switches (e.g., Mininet). The key argument is determinism: virtual switches introduce OS-level scheduling noise, whereas our discrete mathematical model guarantees precise sub-millisecond control over the data-plane simulation.

## 5. Architecture Decision: Pure Simulation vs. Mininet/Real Network Namespaces

```text
Decision:
Use a discrete, virtual-clock software model instead of Mininet (or any real
network-namespace/veth-based emulator) for both the RIB and FIB simulation.

Why:
Mininet's dataplane is real Linux kernel networking — actual veth pairs, actual
OS packet scheduling, actual Open vSwitch forwarding. That means every timing
measurement (propagation delay, grace-window boundaries) inherits real OS
scheduling jitter, which is exactly the kind of noise that makes R13
("repeatable packet probes") hard to guarantee run to run. A pure software
model driven by an explicit virtual clock (a plain float passed as `now`,
never `time.time()`) gives exact, sub-millisecond, fully reproducible control
over every timing boundary in the simulation — the same seed and config
produce byte-identical output every time, which a real kernel network stack
cannot promise.

Alternatives considered:
- Mininet (real Linux network namespaces + Open vSwitch)
- ns-3 (packet-level discrete event network simulator)
- A real OpenFlow controller + software switches (Ryu/ONOS + OVS)

Why rejected:
All three couple the "data plane" to a real, OS-scheduled packet-processing
path. That's a feature for realism, but a liability for this specific PS:
the PS explicitly permits (and the demo requires) a pure software model with
no physical/programmable switch, and the thing being proven — a persisting,
provable divergence — needs to be reproducible on demand in front of judges,
not merely "usually reproducible modulo scheduling noise."

Trade-off:
Less physical/protocol realism (no real ARP, no real link-layer behavior) in
exchange for perfect determinism and zero infrastructure/setup risk during a
live demo. Given R13 and CLAUDE.md's priority order (reliability over
polish/realism), this trade is correct for this project.

Impact on MVP:
Confirms the existing `core/`, `faults/`, `verify/` design (virtual clock,
in-memory tables) needs no rework — this decision was already implicit in
the architecture, now it's explicit and defensible when a judge asks
"why didn't you just use Mininet?"
```

## 6. Architecture Decision: Python vs. C/C++

`docs/ARCHITECTURE.md` §3 stated the language choice from the start but never justified it — a real gap, since §1/§5 justify every other major choice. Recorded here now, prompted by the same "why not the more realistic/lower-level option" question already answered for Mininet in §5.

```text
Decision:
Build the entire simulation in Python 3, not C or C++.

Why:
What's being graded here is whether the simulation logic is obviously
correct, fully tested, and demonstrable live — not whether it can forward
packets at wire speed. Python's stdlib `ipaddress` module gives correct
CIDR/longest-prefix-match for free (core/router.py's forward()); dataclasses
and plain dicts make RIB/FIB modeling direct and readable
(core/router.py, verify/verifier.py's Alert); and there is no compile step
to fail, and no manual memory management to get wrong, in the minutes
before a live demo. All of that maps directly onto CLAUDE.md's priority
order: PS compliance and demo reliability outrank performance (§45), and
performance work is explicitly deferred until correctness and reliability
are already proven (§21) — which for this project never becomes necessary,
because nothing in ps.md or docs/DECISION.md asks for throughput or
wire-speed realism at all.

Alternatives considered:
- C (manual struct-based RIB/FIB, hand-rolled LPM over a trie or array)
- C++ (same, with STL containers and RAII for the table lifecycle)

Why rejected:
Both buy raw packet-processing throughput and memory-layout control that
nothing in this PS asks for — §5 above already establishes that even a
*real* kernel dataplane (Mininet) was rejected in favor of a virtual-clock
model, so trading up to C/C++ for realism this project isn't pursuing
would be solving the wrong problem twice over. In exchange, they cost real
implementation risk that Python's stdlib/dataclasses avoid outright:
hand-written prefix-matching and manual buffer/table lifetime management
are exactly the kind of code that segfaults or leaks under a fault
scenario (DELAY/DROP/CORRUPT) it wasn't first tested against — a crash
mid-demo is a much worse failure mode than a slow one. This is the same
reasoning CLAUDE.md §37 gives for not overengineering: added complexity
that doesn't move any of PS compliance, correctness, or demo reliability
is a cost with no offsetting benefit here.

Trade-off:
No low-level realism (no manual memory layout, no wire-speed throughput
claim, no systems-level packet handling) in exchange for faster iteration,
a smaller/safer surface for bugs, and zero build-step risk right before a
live, judged demonstration.

Impact on MVP:
None — this only makes explicit a choice the codebase already reflects
throughout core/, faults/, and verify/. No rework required.
```
