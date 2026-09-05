# Final Demo Script — PlaneSplit (PS31)

> **ASSUMPTION**: no exact presentation time limit was given by the organizers, so this uses CLAUDE.md §42's own 8-minute template as the default. **Confidence: Medium.** If the actual slot is shorter (e.g. 3–5 minutes), cut straight to Phases 3–5 (scenario 1 first, then scenario 2/3 for the alert) plus the closing line — those are the only parts that carry the PS's actual required proof. **How to verify**: confirm the real slot length with the organizers/judging schedule before presenting.

Rehearsed against the real CLI, not a mockup: `python -m planesplit.cli.demo --all` was actually run and timed (see `docs/STATUS.md`). Program execution is sub-second (0.155s wall time) — the simulation itself is instant by design (deterministic virtual clock, not real delays), so **all of the timing below is presenter narration pacing**, not program runtime.

## 0:00 — Problem (30s)

Say the hook, don't just show it — it's also literally what `cli/demo.py --all` prints first:

> "Every SDN controller, every Kubernetes NetworkPolicy, every BGP route push makes the same silent promise: the rule you configured is the rule actually running on the device. That promise breaks more often than dashboards admit."

## 0:30 — Architecture (30s)

One sentence each, pointing at the ASCII diagram in `README.md` if there's a screen to show it:

- Each router holds two **independent** tables: RIB (intent) and FIB (reality) — nothing in the code lets one read the other.
- The only path from RIB to FIB is the **Update Channel**, which can delay, drop, or corrupt an update — the single point where a fault is ever injected.
- The **Verifier** proves divergence by tracing a real simulated packet through both tables and comparing paths — not by diffing config strings.

## 1:00 — Healthy scenario (60s)

Run: `python -m planesplit.cli.demo --scenario 4`

Narrate: "Scenario 4 is the baseline — a converged network, no changes at all, probed three times. Zero alerts. This is the case that proves the verifier isn't crying wolf by default; it only reacts to a genuine mismatch." Point at the all-PASS rows.

## 2:00 — Inject failure (60s)

Run: `python -m planesplit.cli.demo --scenario 1` then `--scenario 2`

Narrate Scenario 1 first (the *tolerated* case): "We push a route change with a 1-second delay and declare a 2-second grace window. Probe immediately — TOLERATED, not alerted, because this is expected. Probe again after it resolves — PASS." Then Scenario 2 (the *real* failure): "Same setup, but this time the update is silently dropped — a simulated hardware failure. Probe inside the window — still tolerated. Probe after the window expires —"

## 3:00 — Detection (60s)

Let the Scenario 2 ALERT print and read it aloud:

```
1 alert(s) raised:
  - flow=10.0.2.0/24 responsible_router=A detected_at=2.5s
    reason: actual path ['A', 'B', 'C'] no longer matches intended path
    ['A', 'D', 'C'] for flow 10.0.2.0/24, and the grace window (2.0s since
    last legitimate change at 0.0) has elapsed
```

Narrate: "It names the exact flow, the exact router, and both full paths — not 'something diverged.'"

## 4:00 — Verification / evidence (60s)

Run: `python -m planesplit.cli.demo --scenario 3` (the corruption case). Narrate: "This is the proof that we're not just diffing two tables. The control plane intends `10.0.2.0/24` via D; the fault injector corrupts the FIB entry to `/25`. Our prober doesn't probe the network address — it probes the *last host address in the range*, specifically so a narrowed prefix like this is actually observable. That probe falls outside the corrupted `/25` and blackholes at router A. We caught it by routing a real simulated packet through the real table, not by string-comparing `/24` against `/25`."

## 5:00 — Recovery / robustness (60s)

The PS doesn't require automated remediation, so use this slot for the negative-case story instead: "We didn't just test the happy path. Scenario 5 proves two unrelated flows changing at the same time don't interfere with each other's grace window. Scenario 6 proves a route flapping five times in two seconds never alerts mid-flap and still settles on the correct final route. And writing malformed/edge-case tests — empty input, out-of-order events — actually caught two real bugs during development, which we fixed: a broken topology reference used to fail silently instead of raising, and a stale out-of-order update could have shrunk a flow's grace window and caused a false alert. Both are fixed and tested now."

## 6:00 — Technical explanation (60s)

"Everything is driven by an explicit virtual clock — a `now` float passed into every method, never `time.sleep()` or `time.time()`. That's what makes this repeatable: run any scenario twice, get byte-identical output, every time. We proved that by diffing two full runs, not just asserting it."

## 7:00 — Differentiation (60s)

"A lot of tools diff configuration — Batfish, Forward Networks, VeriFlow. What we do differently for this problem statement is prove the *practical consequence* with an actual simulated packet trace, and we track the grace window **per flow**, not globally, which is the part that actually breaks naive implementations under real-world churn like route flapping."

## 8:00 — Final result

"Six scenarios, 43 tests, all passing, one command to run it, and every verdict on screen came from a real computed path comparison — nothing here is hardcoded."

---

## Rehearsal notes (this pass)

- Actual `--all` output: 88 lines. At a natural reading pace that's more than a live audience wants scrolled past in full — for the live demo, run scenarios individually (`--scenario N`) in the sequence above rather than dumping `--all`, and only show the full `--all` table if asked for the complete picture.
- Program runtime is not the bottleneck for pacing (0.155s total) — all 8 minutes above is presenter narration. If the actual slot is shorter, cut Phase 5 (robustness/negative-case story) first — it's the most skippable without losing PS-required proof.
