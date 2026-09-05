# Multi-Agent Build & Verification Plan

## 1. Orchestration Strategy
To ensure the implementation is robust, correct, and rigorously verified, we will use a multi-agent approach to build and test the PlaneSplit MVP concurrently.

## 0. Shared Interface Contract (freeze this BEFORE dispatching any agent)

Agent 2 and Agent 3 both depend on Agent 1's data shapes. Running all three fully in parallel with no fixed contract means Agent 2 and Agent 3 will each guess at what `Router`/`Packet` look like, and the Coordinator inherits an integration-rewrite job instead of a stitch-together job. Freeze this signature set first; every agent codes against it, not against their own assumption:

```python
# core/packet.py
@dataclass
class Packet:
    src: IPv4Address
    dst: IPv4Address
    trace: list[str] = field(default_factory=list)   # router IDs visited, in order

# core/router.py
class Router:
    id: str
    rib: dict[IPv4Network, str]   # prefix -> next_hop router id
    fib: dict[IPv4Network, str]
    def forward(self, packet: Packet, table: Literal["rib", "fib"]) -> str | None: ...
        # longest-prefix-match; appends self.id to packet.trace; None = no match/default

# core/network.py
class Network:
    routers: dict[str, Router]
    def trace_intended(self, packet: Packet) -> list[str]: ...   # walks RIB chain
    def trace_actual(self, packet: Packet) -> list[str]: ...     # walks FIB chain

# core/control_plane.py
class ControlPlaneManager:
    def push_route(self, flow: IPv4Network, router_id: str, next_hop: str) -> RouteUpdate: ...
        # writes to RIB immediately/reliably, then queues the corresponding FIB update
        # to the UpdateChannel below — never writes to FIB directly.

# faults/update_channel.py
class FaultMode(Enum):
    NONE = "none"; DELAY = "delay"; DROP = "drop"; CORRUPT = "corrupt"

class UpdateChannel:
    GRACE_WINDOW_SECONDS: float = 2.0   # the single documented default — see ARCHITECTURE.md §6
    def apply(self, update: RouteUpdate, fault: InjectedFault, now: float) -> None: ...
        # the ONLY place a FIB update may be delayed, dropped, or corrupted.
        # No other module is permitted to fake or shortcut a mismatch.

# verify/verifier.py
@dataclass
class Alert:
    flow: IPv4Network
    responsible_router: str
    expected_path: list[str]
    actual_path: list[str]
    detected_at: float
    reason: str

class Verifier:
    def push_legitimate_change(self, flow: IPv4Network, now: float) -> None: ...
        # (re)sets last_legitimate_change_at for this flow — MUST overwrite on every call,
        # never setdefault-once, or route-flapping (TEST_PLAN.md Scenario 6) breaks silently
    def check(self, flow: IPv4Network, intended: list[str], actual: list[str], now: float) -> Alert | None: ...
```

Agent 1 owns `Packet`/`Router`/`Network`/`ControlPlaneManager`/`UpdateChannel` exactly as shaped above. Agent 2 owns `Verifier` (and the probe-tracing functions) exactly as shaped above, and may start immediately against this signature without waiting for Agent 1's implementation to be finished — only the shape, not the body, needs to exist first. Agent 3 writes tests against both signatures from the start, so tests are ready the moment real implementations land.

### Repo layout (canonical — matches `docs/TASK_BREAKDOWN.md`; this is the ONLY layout, no separate `src/` tree)

```text
planesplit/
├── core/
│   ├── packet.py           # Agent 1
│   ├── router.py           # Agent 1
│   ├── network.py          # Agent 1
│   └── control_plane.py    # Agent 1
├── faults/
│   └── update_channel.py   # Agent 1 (the fault injector — see note below, this was previously unowned)
├── verify/
│   ├── prober.py           # Agent 2 — trace_intended() / trace_actual(), ATPG-style probe generation
│   └── verifier.py         # Agent 2 — grace-window state machine, Alert construction (names the exact flow + router — R9)
├── cli/
│   └── demo.py             # Coordinator — stitches everything into the final runnable demo
├── scenarios/
│   └── *.py                # Coordinator — shared by both cli/demo.py and tests/, single source of truth
├── tests/
│   └── test_*.py           # Agent 3
├── requirements.txt
└── README.md
```

## 2. Agent Assignments

### Agent 1: Core Network Engineer (Implementation)
- **Files:** `core/packet.py`, `core/router.py`, `core/network.py`, `core/control_plane.py`, `faults/update_channel.py`
- **Role:** Build the core routing substrate AND the fault injector — these are grouped together because the fault injector operates directly on the FIB structures Agent 1 owns, and because it must be built by whoever guarantees a router's FIB is never written to except through it.
- **Responsibilities:**
  - Implement `Packet` class (src, dst, trace history).
  - Implement `Router` class with distinct `RIB` (Control Plane) and `FIB` (Data Plane).
  - Implement IPv4 Longest Prefix Match (LPM) routing.
  - Implement `Network` class to link routers and simulate packet traversal.
  - Implement `ControlPlaneManager` (reliable RIB push, never touches FIB directly).
  - **Implement `UpdateChannel`** — the fault injector supporting `DELAY`, `DROP`, and `CORRUPT`/partial-application modes (R4, R5, R6). This was missing an explicit owner in the original agent split; it belongs here because it's the gatekeeper for every FIB write Agent 1's `Router` class exposes.

### Agent 2: Verification Engineer (Implementation)
- **Files:** `verify/prober.py`, `verify/verifier.py`
- **Role:** Build the fault injection and active probing logic.
- **Responsibilities:**
  - Implement the ATPG (Automatic Test Packet Generation) probe generator.
  - Create the verification loop: compare expected path (RIB) vs actual path (FIB).
  - Implement the "Propagation Window" logic (allow temporary divergence, flag persistent divergence) — **per flow/destination, not globally** (this is the single highest-risk piece of the whole project, see §4 Risks).
  - Construct `Alert` objects that name the exact flow/destination and the specific responsible router (R9) — not just "something diverged."

### Agent 3: QA / Test Engineer (Verification)
- **Files:** `tests/test_*.py`
- **Role:** Write rigorous tests to verify the system.
- **Responsibilities:**
  - Write unit tests for LPM routing.
  - Write integration tests proving that delayed updates converge successfully (`TEST_PLAN.md` Scenario 1).
  - Write integration tests proving that dropped/corrupted updates (persistent divergence) are successfully caught by the verifier (Scenarios 2, 3).
  - Write the negative-case tests: true negative, false-positive attempt, route flapping (Scenarios 4, 5, 6) — these are not optional extras, they're what proves the system distinguishes real divergence from ordinary churn.

## 3. Coordinator (Main Agent)
- Review all generated code against the shared interface contract in §0 — reject anything that doesn't match the frozen signatures.
- Own `cli/demo.py` and `scenarios/*.py` — stitch the modules together into a final, runnable, one-command demo.
- Ensure the final output perfectly aligns with the Problem Statement constraints (cross-check against `docs/REQUIREMENTS.md`, all R1–R13 rows).
- Own the stretch-goal polish (README, optional web viz) only after Agents 1–3's work is fully green — see `docs/MILESTONES.md` M4/M5.

### Agent ↔ Workstream mapping (reconciles this doc with `docs/TASK_BREAKDOWN.md`)

The 3-agent split above is *who* does the work; `TASK_BREAKDOWN.md`'s 7 workstreams are *what* the work is and in *what order*, with finer-grained dependencies. They describe the same build, not two competing plans:

| Agent / Coordinator | Workstreams owned |
|---|---|
| Agent 1 | WS1 (Core Data Model), WS2 (Control Plane + Fault Injection) |
| Agent 2 | WS3 (Packet Prober), WS4 (Verifier) |
| Agent 3 | WS6 (Automated Test Suite Hardening) |
| Coordinator | WS5 (CLI Demo), WS7 (Polish / Stretch) |

## 4. Risks (referenced by `TASK_BREAKDOWN.md` WS4 and `MILESTONES.md` M3)

| Risk | Why it matters | Fallback |
|---|---|---|
| **Grace-window tracked globally instead of per-flow** | The single mechanism the whole PS hinges on; the false-positive-attempt and route-flapping tests (Scenarios 5, 6) exist specifically to catch this | Build Scenario 5 before any happy-path test, per `TASK_BREAKDOWN.md` WS4 |
| **Wall-clock flakiness** (`time.sleep`/`time.time()` instead of an explicit `now` parameter) | Breaks R13 (repeatable probes); makes test runs nondeterministic | Enforce the `now` parameter convention from the first commit — see ARCHITECTURE.md §5 (Mininet decision) for why this matters |
| **Web viz stretch goal eats time meant for the core CLI/tests** | Priority order (`CLAUDE.md`) ranks polish last | Hard rule: no web viz work starts before all 6 `TEST_PLAN.md` scenarios pass and the CLI demo runs clean twice in a row |
| **Fault injector left unowned** (this document's own gap until this revision) | R4–R6 have no home without it | Fixed above — now explicitly Agent 1's responsibility |
