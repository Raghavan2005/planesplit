# Status — PlaneSplit (PS31)

> Kept current per `CLAUDE.md` §49 — updated in the same commit as any change that would make it stale. This is the fastest way to see where the project actually stands right now, without reconstructing it from `git log`.

**Last updated:** 2026-09-05 (M5 timed rehearsal + FINAL_DEMO_SCRIPT.md done; nothing left outstanding)

## Current phase
Complete. M0–M4 done and independently re-verified; Q2 (negative/edge-case testing) closed, surfacing and fixing 2 real bugs; every row in `docs/REQUIREMENTS.md` (R1–R13, Q1–Q3) is Done with real code/test citations; M5's timed rehearsal (`docs/FINAL_DEMO_SCRIPT.md`) is done. The only item not built is the stretch-goal web visualization, which is a deliberate, documented choice, not an oversight (see "Known gaps" below).

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
- **M2 (Control Plane + Fault Injection + Prober)**: `ControlPlaneManager.push_route()` (RIB write only, returns `RouteUpdate` for the caller to hand to the channel — CPM itself never touches FIB or fault logic). `UpdateChannel` implementing DELAY (explicit `tick(now)`, no wall clock), DROP (silent), CORRUPT (writes a shifted-prefix FIB entry) as the sole path to any FIB write; `GRACE_WINDOW_SECONDS = 2.0` declared here per the frozen contract. `verify/prober.py` generates boundary probes (last host address in the flow) so a narrowed corrupt prefix is actually observable rather than silently covered. 7 more unit tests.
- **M3 (Verifier + full pipeline integration)**: `Alert`/`Verifier` implemented — per-flow grace-window dict, `push_legitimate_change()` always overwrites (never `setdefault`-once). All 6 `docs/TEST_PLAN.md` scenarios implemented as full-pipeline integration tests (`tests/test_scenarios.py`) and passing: true negative (Scenario 4, run first), normal delayed convergence (1), dropped update (2), partial-application corruption detected via boundary probing (3), independent per-flow grace windows under concurrent changes (5), and route flapping with correct final-state settlement (6). 5 more isolated `Verifier` unit tests (`tests/test_verifier.py`). Full suite: 25/25 passing.

- **M4 (CLI Demo + Test Suite Hardening)**: `scenarios/definitions.py` — shared, deterministic scenario functions (one per `TEST_PLAN.md` scenario, each building a fresh pipeline internally) used by both `cli/demo.py` and `tests/test_repeatability.py`, the single source of truth `docs/BUILD_PLAN.md` §0 calls for. `cli/demo.py` — `rich`-based CLI (`python -m planesplit.cli.demo [--all | --scenario N]`), color-coded PASS/TOLERATED/ALERT table plus a detailed alert reason printout. `tests/test_repeatability.py` proves R13: every scenario run twice produces byte-identical results (field-by-field comparison, since `Alert` isn't directly `==`-comparable). Manually verified the full `--all` demo run twice via redirected output and diffed byte-for-byte identical. Fixed a UX bug caught during manual testing: `--scenario N` was indexing into `ALL_SCENARIOS`' *run order* (which starts with Scenario 4) instead of the scenario's own `TEST_PLAN.md` number — added a separate `SCENARIO_BY_NUMBER` mapping so `--scenario 3` actually runs Scenario 3. Full suite: 26/26 passing.

- **M5 (partial, optional)**: root `README.md` added (setup/run/test/demo commands, architecture diagram, scenario table, doc index). Closes `docs/REQUIREMENTS.md` Q3 (one-command start/reset). `cli/demo.py` now opens with a "Why this matters" panel and closes with a "What you just saw" panel, resolving the last unactioned `docs/DEMO.md` jury comment (narrative hook + styling) — the hook deliberately avoids citing any specific unverified incident, per CLAUDE.md §4/§8, and frames the general, documented failure class instead. 3 new CLI smoke tests.
- **Repo hygiene**: all 12 commits rewritten to remove `Co-Authored-By: Claude` trailers (GitHub was showing Claude as a co-author) and to use the git author email that matches the GitHub account, so commits link to the correct profile. History was force-pushed after a local backup tag; verified via the GitHub API that every commit now shows `author_login: Raghavan2005` with no Claude attribution. Added `CLAUDE.md` §50: no commit may include an AI-attribution footer going forward.
- **Requirements verification pass**: every R1–R13 and Q1 row in `docs/REQUIREMENTS.md` re-checked against the real codebase and updated from "Planned" to "Done" with actual file/test citations. Found and closed one real gap: R7's explicit boundary-condition test (`window_end - ε` tolerated, `window_end + ε` and exactly `window_end` alert) had never been written — added as 3 tests in `test_verifier.py`.
- **Q2 closed — negative/edge-case testing** (`test_negative_cases.py`, 11 tests): malformed IP input, missing host attachment, duplicate probes, duplicate/out-of-order legitimate-change notifications, a degenerate `/32` flow, and large/looping topologies. Writing these surfaced **two real bugs, both fixed**:
  1. `Network._trace()` silently returned an empty/truncated path when a next-hop or host-attachment pointed at an unregistered router id (a broken topology reference), instead of raising. If both RIB and FIB hit the same broken reference, `Verifier.check()` would have read the resulting empty-vs-empty paths as "converged" — hiding the misconfiguration entirely. Now raises `ValueError` immediately.
  2. `Verifier.push_legitimate_change()` had no protection against an out-of-order/stale call moving `last_legitimate_change_at` backwards, which could shrink a flow's grace window and produce a false-positive alert on a flow that had actually changed more recently. Now ignores any call whose `now` is older than the flow's currently recorded change.

- **M5 timed rehearsal**: `docs/FINAL_DEMO_SCRIPT.md` created (CLAUDE.md §42 requirement, previously missing entirely). Built from an actually-measured run (`--all` wall time: 0.155s; 88 lines of output) rather than guessed pacing — every command and quoted output line in the script was re-run and verified to match real CLI output before being written down. Notes that program runtime isn't the pacing bottleneck (it's all presenter narration) and recommends running scenarios individually live rather than dumping `--all`.

## In progress
Nothing.

## Next up
Nothing required.

## Known gaps / not yet covered
- `ControlPlaneManager.push_route()`'s relationship to `UpdateChannel.apply()` is an implementation decision not spelled out in `docs/BUILD_PLAN.md` §0's frozen contract (which shows no `now`/fault params on `push_route`): CPM never calls the channel itself — the caller (scenario code) does, immediately after `push_route()` returns the `RouteUpdate`. Documented as an assumption here since no other doc states it explicitly.
- **`backend/` and `frontend/` — a 3D web visualization matching `docs/UI_PLAN.md`, added to the repo but not yet reconciled with `planesplit/`.** This reverses the earlier "CLI-only" decision (`docs/ARCHITECTURE.md` §4, `docs/MVP.md` §3) — that reversal hasn't been re-recorded as a formal decision yet, only tracked here. Real, known issues, none fixed yet:
  1. `backend/network.py` **reimplements** `Router`/`Network`/`Packet` from scratch instead of importing the tested `planesplit/core/` classes — a second, unverified copy of logic that already exists, tested, in `planesplit/`.
  2. **No grace window** — `verify_prefix()` compares control-plane vs data-plane paths immediately with no tolerated-delay concept, which is the actual core mechanism PS31 asks for.
  3. **Uses a real wall-clock `await asyncio.sleep(2)`** to simulate delay — exactly what `docs/ARCHITECTURE.md` §5's decision record rejected, since it breaks deterministic repeatability (R13).
  4. **No `Verifier`/`Alert`, no tests** — nothing constructs a PASS/TOLERATED/ALERT verdict server-side with evidence; the frontend gets raw paths only.
  5. **State accumulates across WebSocket actions** without a reset between them — injecting one fault after another in the same session can leave stale FIB rules in place.
  6. `CORSMiddleware(allow_origins=["*"], allow_credentials=True)` — browsers reject this combination in strict mode; a real misconfiguration, low risk for a local demo.
  7. No `requirements.txt` for `backend/` — the venv exists locally but isn't reproducible from the repo alone.
  - **Not yet decided**: whether to fix `backend/` to import and wrap the real `planesplit` logic (recommended — keeps one tested source of truth) or leave it as an independent prototype.

## Test status
43/43 tests passing (`test_core.py`, `test_control_and_faults.py`, `test_verifier.py`, `test_scenarios.py`, `test_repeatability.py`, `test_cli_smoke.py`, `test_negative_cases.py`). No failures, no skips. Working tree clean; local `master` confirmed identical to `origin/master`.
