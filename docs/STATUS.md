# Status — PlaneSplit (PS31)

> Kept current per `CLAUDE.md` §49 — updated in the same commit as any change that would make it stale. This is the fastest way to see where the project actually stands right now, without reconstructing it from `git log`.

**Last updated:** 2026-09-05 (M1 and M2 complete — core routing substrate and fault injection implemented and tested)

## Current phase
M2 (Control Plane + Fault Injection + Prober) complete. Next is M3 (Verifier + full pipeline integration) — the milestone flagged in `docs/MILESTONES.md` as the critical one most likely to run over budget.

## Done
- Problem statement selected and locked: PS31 PlaneSplit (`ps.md`, `docs/DECISION.md`).
- Full research pass: existing solutions/gap analysis, academic grounding (`docs/RESEARCH.md`, `docs/EXISTING_SOLUTIONS.md`).
- Architecture finalized: Router with independent RIB/FIB, Update Channel as sole fault-injection point, per-flow grace-window Verifier (`docs/ARCHITECTURE.md`).
- Requirements traced: all 13 PS-derived requirements (R1–R13) mapped to implementation/test/demo proof (`docs/REQUIREMENTS.md`).
- Test plan: 6 scenarios covering normal convergence, dropped update, corruption, true negative, false-positive attempt, and route flapping (`docs/TEST_PLAN.md`).
- Build plan, task breakdown, and milestones written and internally consistent — one canonical repo layout, agent/workstream ownership mapped, cross-references verified (`docs/BUILD_PLAN.md`, `docs/TASK_BREAKDOWN.md`, `docs/MILESTONES.md`).
- GitHub repo created and initial docs pushed: https://github.com/Raghavan2005/planesplit
- **M0 (Setup)**: `planesplit/` package skeleton created exactly per `docs/BUILD_PLAN.md` §0 canonical layout. `planesplit/requirements.txt` (`rich`, `pytest`) added. Gate verified clean.
- **M1 (Core Data Model)**: `Packet` (dataclass), `Router` (independent RIB/FIB dicts, LPM `forward()` — no cross-reads between tables), `Network` (`trace_intended()`/`trace_actual()` walking the RIB/FIB chain from a host's attachment router, resetting `packet.trace` per call). 7 unit tests on a 4-router topology (A-B-C primary, A-D-C alternate) covering LPM prefix selection, no-match/blackhole, and divergent-path tracing.
- **M2 (Control Plane + Fault Injection + Prober)**: `ControlPlaneManager.push_route()` (RIB write only, returns `RouteUpdate` for the caller to hand to the channel — CPM itself never touches FIB or fault logic). `UpdateChannel` implementing DELAY (explicit `tick(now)`, no wall clock), DROP (silent), CORRUPT (writes a shifted-prefix FIB entry) as the sole path to any FIB write; `GRACE_WINDOW_SECONDS = 2.0` declared here per the frozen contract. `verify/prober.py` generates boundary probes (last host address in the flow) so a narrowed corrupt prefix is actually observable rather than silently covered. 7 more unit tests. Full suite: 14/14 passing.

## In progress
Nothing — M2 gate met. Next unit of work is M3 (Verifier).

## Next up
M3 per `docs/MILESTONES.md`: implement `Alert`/`Verifier` (per-flow grace-window state machine, `push_legitimate_change()` that always overwrites — never `setdefault`-once, or route flapping breaks silently), wire the full pipeline end-to-end, and implement all 6 `docs/TEST_PLAN.md` scenarios as integration tests — Scenario 5 (false-positive attempt) built before any happy-path test, per the risk note in `docs/BUILD_PLAN.md` §4.

## Known gaps / not yet covered
- `TEST_PLAN.md` doesn't yet cover malformed/empty input or duplicate/out-of-order probes — deferred until real usage in the M3 integration tests clarifies the exact malformed-input shape worth testing.
- Web visualization is stretch-only (M5) and may not be attempted at all if time runs short — this is the planned outcome, not a shortfall.
- `ControlPlaneManager.push_route()`'s relationship to `UpdateChannel.apply()` is an implementation decision not spelled out in `docs/BUILD_PLAN.md` §0's frozen contract (which shows no `now`/fault params on `push_route`): CPM never calls the channel itself — the caller (scenario code) does, immediately after `push_route()` returns the `RouteUpdate`. Documented as an assumption here since no other doc states it explicitly.

## Test status
14/14 tests passing (`planesplit/tests/test_core.py`, `test_control_and_faults.py`). No failures, no skips.
