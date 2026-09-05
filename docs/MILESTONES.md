# Milestones — PlaneSplit (PS31)

> **ASSUMPTION**: this is paced for a ~24–48 hour hackathon build window, since no exact duration was given. **Confidence: Medium.** If the actual window is different, rescale the percentages below rather than the task order — the sequence (WS1→WS4 before WS5/WS6, WS7 last and optional) should not change regardless of total time available. **How to verify**: confirm actual hackathon hours remaining against the organizer's schedule and rescale.

Each milestone lists its gating criteria — do not move to the next milestone until the current one's criteria are actually met, not just attempted.

## M0 — Setup (first ~5% of time budget)
- Repo layout created (`docs/BUILD_PLAN.md` §0, "Repo layout (canonical)").
- `requirements.txt` with `rich` + `pytest`.
- Empty module stubs for `core/`, `faults/`, `verify/`, `cli/`, `scenarios/`, `tests/`.
- **Gate**: `pip install -r requirements.txt` succeeds from a clean environment; `pytest tests/` runs (even with zero tests) without import errors.

## M1 — Core Data Model (WS1) (next ~15%)
- `Packet`, `Router` (RIB/FIB/LPM `forward()`), `Network` implemented and unit-tested.
- **Gate**: unit tests for LPM correctness pass, including the no-match/default-route case, on a real 3–5 node topology with an alternate path.

## M2 — Control Plane + Fault Injection, and Prober (WS2 + WS3, parallel) (next ~20%)
- `ControlPlaneManager.push_route()`, `UpdateChannel` (delay/drop/corrupt), `trace_intended()`, `trace_actual()` implemented and unit-tested in isolation.
- **Gate**: each of the three fault modes independently verified by a unit test; both trace functions independently verified against a manually-constructed mismatched topology.

## M3 — Verifier + Full Pipeline Integration (WS4) (next ~20% — treat as the critical milestone)
- Per-flow `FlowState` grace-window tracking, `Verifier.check()` state machine, `Alert` construction with divergence-point identification.
- Full pipeline wired end-to-end.
- **Gate**: all `TEST_PLAN.md` scenarios pass end-to-end — **including Scenario 5 (false-positive attempt), built and passing before declaring this milestone done**, per `TASK_BREAKDOWN.md` WS4's explicit ordering note. (Written when the plan had 5 scenarios; Scenario 6 was added afterward — the gate covers all 6 now.) This is the milestone most likely to run over budget; if it does, everything downstream shrinks, not this one. **Met**: all 6 pass, `tests/test_scenarios.py`.

## M4 — CLI Demo + Test Suite Hardening (WS5 + WS6, parallel) (next ~20%)
- `rich`-based CLI output for all three probe states (PASS/TOLERATED/ALERT).
- Shared `scenarios/*.py` definitions used by both CLI and `pytest`.
- One-command full demo run (`--all`).
- Repeatability regression test passing (same seed → identical output, twice).
- **Gate**: `pytest tests/` fully green; CLI demo runs clean twice in a row with identical output on the same seed.

## M5 — Polish / Stretch (WS7) (remaining time, cut first if short)
- README with setup/run/test instructions.
- Demo script rehearsal against `DEMO.md`, timed.
- **Only if time remains**: JSON snapshot + static web viz.
- **Gate**: none required to "finish" — this milestone is explicitly optional. A project that stops at M4 with a fully green test suite and a working CLI demo is a complete, PS-compliant submission.

## Hard rule across all milestones
Per `BUILD_PLAN.md` §4 (Risks), do not begin any M5 stretch work (especially the web viz) until M4's gate is met. If M3 runs long, M5 is skipped entirely — that is the intended, planned outcome, not a failure.
