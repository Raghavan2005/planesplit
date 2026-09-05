# PlaneSplit

**PS31 — Control-Plane and Data-Plane Consistency Verification**

## The problem

In any real network — SDN, Kubernetes NetworkPolicy propagation, BGP,
service meshes — there are two separate sources of truth:

- **The control plane**, which decides what *should* happen (the intended
  routing/forwarding rules).
- **The data plane**, which decides what *actually* happens to a packet
  (the rules a device is really running right now).

An update pushed from the control plane can be delayed, silently dropped, or
partially applied on its way to the data plane. When that happens, the two
planes disagree, and a device keeps forwarding traffic according to stale or
corrupted rules — invisibly, until someone notices packets going somewhere
they shouldn't. A short propagation delay after a legitimate change is
normal and must be tolerated; a mismatch that never resolves is a real fault
that must be caught.

## What this is

A pure-software, deterministic simulation — no physical switches, no
Mininet, no real network stack — of a small router network where:

- Each `Router` holds two **genuinely independent** tables: a `RIB`
  (control-plane intent) and a `FIB` (data-plane reality). Nothing in the
  code ever lets one read the other directly.
- The only path from RIB to FIB is the **Update Channel**, which can
  deliver an update normally, delay it, drop it, or corrupt it (e.g. write
  a `/25` when the intent was `/24`) — this is the single point in the
  whole system where a fault is ever injected.
- A **Verifier** proves divergence the same way a real operator would have
  to: by tracing a simulated packet through both the RIB and the FIB and
  comparing the two resulting paths, not by diffing configuration strings.
  A mismatch inside a declared grace window (default 2.0s) after a
  legitimate change is expected and tolerated; a mismatch that persists
  past the window is flagged with the exact flow, the responsible router,
  and both paths as evidence.
- Grace-window state is tracked **per flow**, not globally — a stale,
  already-expired divergence on one flow can never mask, or be masked by, a
  fresh, still-tolerated change on another (this is deliberately the
  hardest part of the system to get right — see `docs/BUILD_PLAN.md` §4).

Full background, the alternatives considered, and why they were rejected
are in `docs/ARCHITECTURE.md` and `docs/DECISION.md`. The exact problem
statement text is in `ps.md`.

## Architecture at a glance

```text
ControlPlaneManager          UpdateChannel (fault injector)         Router
──────────────────           ─────────────────────────────         ──────
push_route(flow, ...)  ───►  apply(update, fault, now)        ───►  .fib[flow] = next_hop
   │                              │  DELAY / DROP / CORRUPT
   ▼                              │  (the ONLY place a mismatch
 .rib[flow] = next_hop            │   can ever originate)
   (immediate, reliable)          ▼
                              .fib written independently

                    Verifier
                    ────────
Network.trace_intended(pkt)  ──►  walks the RIB chain  ──┐
Network.trace_actual(pkt)    ──►  walks the FIB chain  ──┼──► Verifier.check(flow, intended, actual, now)
                                                          │        │
                                                          │        ├─ paths match            → PASS
                                                          │        ├─ mismatch, inside window → TOLERATED
                                                          │        └─ mismatch, window elapsed → ALERT (Alert:
                                                          │                                        flow, responsible_router,
                                                          │                                        expected_path, actual_path,
                                                          │                                        reason)
                                                                       │
                                          ┌────────────────────────────┴───────────────────────────┐
                                          ▼                                                          ▼
                          correlate(alerts) [added-value]                    Remediator.remediate(alert, now) [added-value]
                          ─────────────────────────────                      ────────────────────────────────
                          groups Alerts by responsible_router                reads the correct next_hop straight from the
                          → RootCauseReport (1 shared cause,                 flow's own RIB entry (never faulted) and
                            not N separate-looking alerts)                   replays it through one clean apply() call
```

The two branches at the bottom are **not** part of the PS31 baseline — see
"Added-value innovations" below.

## Project layout

```text
planesplit/
├── core/            Packet, Router (RIB/FIB + longest-prefix-match), Network (path tracing)
├── faults/           UpdateChannel — the fault injector (DELAY / DROP / CORRUPT), GRACE_WINDOW_SECONDS
├── verify/            prober.py (boundary-aware probe generation), verifier.py (Alert, per-flow grace-window check),
│                       correlator.py (added-value: group alerts by root cause), remediator.py (added-value: auto-fix)
├── cli/              demo.py — one-command runnable demo
├── scenarios/         definitions.py — shared, deterministic scenario definitions (used by both the CLI and the tests)
├── tests/             58 tests: unit (core, faults, verifier, remediator, correlator) + integration (all 6 scenarios) + repeatability + CLI smoke
└── requirements.txt

docs/                 research, architecture decisions, requirements traceability matrix,
                       test plan, build plan, milestones, status
ps.md                 the original problem statement text
```

## Setup

```bash
pip install -r planesplit/requirements.txt
```

## Run tests

```bash
pytest planesplit/tests/
```

58 tests, all passing, including: 7 core-model unit tests, 7 fault-injection/
prober unit tests, 8 verifier unit tests, 6 full-pipeline integration tests
(one per `docs/TEST_PLAN.md` scenario), 11 negative/edge-case tests, 11 tests
for the two added-value features — remediation and correlation
(`docs/INNOVATION.md`) — and repeatability + CLI smoke tests that run every
scenario/demo twice and assert identical output.

## Run the demo

```bash
python -m planesplit.cli.demo --all                # every scenario
python -m planesplit.cli.demo --scenario 3         # a single scenario by its docs/TEST_PLAN.md number (1-6)
python -m planesplit.cli.demo --remediation-demo   # added-value auto-remediation demo (docs/INNOVATION.md)
python -m planesplit.cli.demo --correlation-demo   # added-value multi-flow root-cause correlation demo (docs/INNOVATION.md)
```

Output is a color-coded table (PASS / TOLERATED / ALERT per probe) followed
by full evidence for any alert raised — not just "something diverged":

```text
2 alert(s) raised:
  - flow=10.0.2.0/24 responsible_router=A detected_at=2.5s
    reason: actual path ['A', 'B', 'C'] no longer matches intended path
    ['A', 'D', 'C'] for flow 10.0.2.0/24, and the grace window (2.0s since
    last legitimate change at 0.0) has elapsed
```

### The six scenarios

| # | Name | Proves |
|---|------|--------|
| 1 | Normal delayed update | A transient delay that resolves inside the grace window is tolerated, not alerted |
| 2 | Dropped update | A silently lost FIB update is caught once the grace window expires |
| 3 | Partial application / corruption | A narrowed prefix (`/24` written as `/25`) is caught by a boundary-address probe |
| 4 | True negative (steady state) | A converged, unchanging network never alerts — the baseline that proves the verifier isn't crying wolf |
| 5 | Concurrent independent flows | Two unrelated, overlapping legitimate changes on different flows don't interfere with each other's grace window |
| 6 | Route flapping | Five rapid legitimate changes to the *same* flow never alert mid-flap, and the final state settles correctly |

## Added-value innovations

Two capabilities beyond what PS31 literally asks for. Both are deliberately
documented separately in `docs/INNOVATION.md`, kept out of
`docs/REQUIREMENTS.md`'s R1–R13 traceability matrix, and excluded from
`ALL_SCENARIOS`/`SCENARIO_BY_NUMBER` (the six scenarios above) — so neither
is ever confused with the literal PS text or mistaken for a required
scenario. Both are fully deterministic: no LLM, no invented confidence
scores, no candidate-fix guessing (see `docs/INNOVATION.md` for why that's
a deliberate design constraint, not a missed opportunity).

### Multi-flow root-cause correlation

```bash
python -m planesplit.cli.demo --correlation-demo
```

Without this, if one broken router takes down 10 flows, `Verifier.check()`
(which evaluates every flow independently, by design) produces 10 separate
`Alert` objects — alert fatigue, hiding the fact that there's really one
root cause. `correlate(alerts)` groups alerts by `Alert.responsible_router`
into a `RootCauseReport`. This is an **exact** grouping, not a heuristic
guess: the fault model only ever targets one router per update, so two
alerts naming the same router are the same deterministic fact observed
twice, not a coincidence worth scoring a confidence number on. The demo
corrupts two independent flows through the same router and shows both
alerts collapsed into one report:

```text
Root Cause Analysis
2 flows (10.0.2.0/24, 10.0.3.0/24) all diverge at the same router: A.
Reported as one shared root cause instead of separate, seemingly
unrelated alerts.
```

`verify/correlator.py` · `tests/test_correlator.py` (5 tests) · full design
rationale (including why the *general* fault-localization problem is
NP-hard and why this system's narrower version isn't) in
`docs/INNOVATION.md` "Innovation 1".

### Closed-loop deterministic remediation

```bash
python -m planesplit.cli.demo --remediation-demo
```

Detection alone still leaves a human to type in the fix by hand.
`Remediator.remediate(alert, now)` closes that loop: since the RIB is
*never* faulted (only `UpdateChannel.apply()` can corrupt a FIB), the
correct value for any alerted flow already exists, uncorrupted, in that
flow's own RIB entry. Remediation is therefore "read the value that was
never wrong, and write it to the place that was" — one more `apply()` call
made with a clean fault mode — not a diagnostic step choosing among
candidate fixes. The demo reproduces Scenario 3's exact corruption, then
fixes it and re-probes:

```text
| Remediation Demo | T=3.0s (corrupted FIB entry)      | 10.0.2.0/24 | A -> D -> C | A            | ALERT |
| Remediation Demo | T=3.0s (after auto-remediation)   | 10.0.2.0/24 | A -> D -> C | A -> D -> C  | PASS  |
```

If the same router breaks again later, nothing silently re-patches it
forever: `remediate()` reuses `Verifier`'s existing per-flow grace-window
logic (via `push_legitimate_change`), so a persistent, recurring fault
correctly produces a fresh `Alert` instead of being hidden — see
`tests/test_remediator.py`'s two escalation tests for the exact proof.

`verify/remediator.py` · `tests/test_remediator.py` (6 tests) · full
design rationale in `docs/INNOVATION.md` "Innovation 2".

## Reset

There is nothing to reset. The demo and every test build a fresh, in-memory
topology from scratch on each run — no persisted state, no database, no
setup/teardown step. Re-running the command above *is* the reset, and it is
deterministic: the same scenario produces byte-identical output every time
(proven by `tests/test_repeatability.py`, and manually verified by diffing
two full `--all` runs).

## Documentation

| Doc | Contents |
|---|---|
| `docs/DECISION.md` | Why PS31 was chosen over the other two candidate problem statements |
| `docs/RESEARCH.md`, `docs/EXISTING_SOLUTIONS.md` | Prior art (Batfish, Forward Networks, VeriFlow, academic ATPG/header-space-analysis work) and what this project does/doesn't borrow from it |
| `docs/ARCHITECTURE.md` | Component design and the formal decision record for pure simulation vs. Mininet/ns-3/real OpenFlow |
| `docs/REQUIREMENTS.md` | Every PS clause mapped to interpretation → implementation → test → demo proof |
| `docs/TEST_PLAN.md` | The six scenarios above, in full detail |
| `docs/BUILD_PLAN.md`, `docs/TASK_BREAKDOWN.md`, `docs/MILESTONES.md` | How the build was planned and sequenced |
| `docs/STATUS.md` | Current state — what's implemented, tested, and next |
| `docs/INNOVATION.md` | Added-value capabilities beyond the PS31 baseline (multi-flow root-cause correlation, closed-loop deterministic remediation) — never confused with R1–R13 |

## Known gaps

- A served web visualization was scoped as a stretch goal only and has not
  been built to the same standard as `planesplit/` — see `docs/STATUS.md`
  "Known gaps" for the specifics of the `backend/`/`frontend/` prototype.
