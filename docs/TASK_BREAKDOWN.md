# Task Breakdown — PlaneSplit (PS31)

Organized by workstream, not by person — assign however many people you have. Dependencies are strict: a workstream should not start until everything it depends on is at least passing its own unit tests. If working solo, follow the order top to bottom.

## WS1 — Core Data Model (foundational, blocks everything else)
| Task | Output | PS req | Test |
|---|---|---|---|
| Implement `Packet` dataclass | `core/packet.py` | R1 | Unit: construct, append to trace |
| Implement `Router` (RIB, FIB, longest-prefix-match `forward()`) | `core/router.py` | R2, R3 | Unit: LPM correctness incl. no-match/default case |
| Implement `Network` (topology graph holding Routers) | `core/network.py` | R1 | Unit: build 3–5 node topology, look up neighbors |

**Exit criteria to unblock WS2/WS3**: `Router.forward()` correctly resolves longest-prefix-match against both RIB and FIB independently, verified by unit test, for a topology with at least one alternate path.

## WS2 — Control Plane + Fault Injection (depends on WS1)
| Task | Output | PS req | Test |
|---|---|---|---|
| Implement `ControlPlaneManager.push_route()` (reliable RIB push) | `core/control_plane.py` | R2 | Unit: RIB updates instantly, no delay possible |
| Implement `UpdateChannel` with `DELAY` mode | `faults/update_channel.py` | R4 | Unit: FIB updates at `issued_at + delay` |
| Implement `UpdateChannel` with `DROP` mode | same file | R5 | Unit: FIB never updates |
| Implement `UpdateChannel` with `CORRUPT` mode | same file | R6 | Unit: FIB updated with wrong prefix/next_hop |

**Exit criteria to unblock WS4**: all three fault modes independently unit-tested against a single router without needing the full Verifier.

## WS3 — Packet Prober (depends on WS1, parallel with WS2)
| Task | Output | PS req | Test |
|---|---|---|---|
| Implement `trace_intended()` (walks RIB chain) | `verify/prober.py` | R10 | Unit: known topology → known expected path |
| Implement `trace_actual()` (walks FIB chain) | same file | R3, R10 | Unit: same, using FIB |

**Exit criteria to unblock WS4**: both trace functions return correct hop lists on a topology with a deliberately mismatched FIB (manually constructed, not yet via UpdateChannel). **Met**: `UpdateChannel` is now fully implemented (`faults/update_channel.py`) and every `test_scenarios.py` integration test drives the mismatch through it end-to-end, superseding the manually-constructed bootstrap case this note originally described.

## WS4 — Verifier (depends on WS2 + WS3 — the critical-path, highest-risk piece)
| Task | Output | PS req | Test |
|---|---|---|---|
| Implement per-flow `FlowState` tracking (grace window start per flow, not global) | `verify/verifier.py` | R7 | **Build this test first**: `TEST_PLAN.md` Scenario 5 (false-positive attempt, two concurrent flows) |
| Implement `Verifier.check()` state machine (converged / tolerated / alert) | same file | R7, R8 | `TEST_PLAN.md` Scenarios 1, 2, 4 |
| Implement `Alert` construction with divergence-point router identification | same file | R9 | Assert alert names exact router + flow |
| Wire full pipeline: `ControlPlaneManager` → `UpdateChannel` → `Router.fib` → `Prober` → `Verifier` | integration | R1–R10 | `TEST_PLAN.md` Scenario 3 (corruption, full pipeline) |

**Exit criteria to unblock WS5/WS6**: all `TEST_PLAN.md` scenarios pass end-to-end through the full pipeline, not just in isolation. (Written when the plan had 5 scenarios; Scenario 6 — route flapping — was added afterward per the SRE/QA jury comment. **Met**: all 6 pass, `tests/test_scenarios.py`.)

> **Do this workstream's false-positive test (Scenario 5) before its happy-path tests.** Per `BUILD_PLAN.md` §4 (Risks), a global-instead-of-per-flow grace window is the single most likely bug in this project, and Scenario 5 is the only test that reliably catches it. Building it last means discovering the bug after everything else is already built on top of the wrong assumption.

> **Agent mapping**: this workstream is owned by Agent 2 in `BUILD_PLAN.md` §2/§3.

## WS5 — CLI Demo (depends on WS4)
| Task | Output | PS req | Test |
|---|---|---|---|
| `rich`-based per-probe output (flow, intended path, actual path, PASS/TOLERATED/ALERT) | `cli/demo.py` | R9, R10 | Manual + smoke test asserting no crash |
| Wire `scenarios/*.py` definitions shared with tests | `scenarios/` | R11, R12, R13 | Same scenario objects imported by `tests/test_scenarios.py` |
| One-command full run (`--all` flag runs all demo phases in order) | `cli/demo.py` | demo flow (§10) | Manual: full run twice, compare output |

## WS6 — Automated Test Suite Hardening (depends on WS4, parallel with WS5)
| Task | Output | PS req | Test |
|---|---|---|---|
| Port all `TEST_PLAN.md` scenarios into `pytest` (6, after Scenario 6 was added) | `tests/test_scenarios.py` | R11, R12, Q2 | `pytest tests/` green |
| Repeatability regression test (same seed twice → identical output) | `tests/test_repeatability.py` | R13 | `pytest` green, run manually 3x to confirm no flakiness |
| Unit test coverage for `Router`, `UpdateChannel`, `Verifier` in isolation | `tests/test_*.py` | R1–R9 | `pytest` green |

## WS7 — Polish / Stretch (only after WS5 + WS6 are fully green)
| Task | Output | PS req | Test |
|---|---|---|---|
| README with setup/run/test/reset instructions | `README.md` | CLAUDE.md §29 | Fresh-clone smoke test |
| (Stretch) JSON state snapshot writer | `cli/snapshot.py` | none (not a PS req) | Manual |
| (Stretch) Static web page reading the snapshot | `web/` | none (not a PS req) | Manual, open in browser |
| Final demo script rehearsal (timing against `DEMO.md`) | — | — | Full run-through, timed |

## Dependency graph (text form)

```text
WS1 ──▶ WS2 ──┐
   └──▶ WS3 ──┴──▶ WS4 ──┬──▶ WS5 ──┐
                          └──▶ WS6 ──┴──▶ WS7 (optional)
```
