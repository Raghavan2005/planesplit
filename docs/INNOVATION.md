# Innovation: Multi-Flow Root-Cause Correlation

This is an added-value capability beyond the PS31 baseline — it is **not** one of the R1–R13 requirements in `docs/REQUIREMENTS.md` and doesn't replace anything there. Documented separately so it's never confused with literal PS text (per `CLAUDE.md` §2, never invent or blur requirements).

## 1. Understand — what problem this actually solves

Today, `Verifier.check()` evaluates each flow completely independently (by design — see `docs/ARCHITECTURE.md` §2D, this is what makes Scenario 5's concurrent-flow test possible). That's correct for *detection*, but it has a real operational cost: if one bad router breaks 10 flows that all happen to route through it, the operator gets 10 separate `Alert` objects, not "one router is broken, here are the 10 flows it's taking down with it." That's alert fatigue, a well-known real-world NOC problem — the interesting signal (there's one root cause) is buried in the noise (many symptoms).

## 2. Research — what already exists

- **Sherlock / SCORE-style fault localization** (used in real telecom/datacenter NOCs) solves a *harder* version of this problem: given only symptom observations (e.g. "these 10 paths are broken") with no direct visibility into *why*, infer the smallest set of underlying components whose failure explains all the symptoms. This is a minimal-hitting-set problem and is NP-hard in general.
- **VeriFlow / Header Space Analysis** verify data-plane correctness but report per-violation, not correlated across flows.

**Engineering inference, not a verified citation**: I know of these techniques from general domain knowledge, not from re-reading a specific paper for this project — flagged per `CLAUDE.md` §4 as an inference, not a confirmed source. Treat the names as pointers to a family of technique, not as a claim that we implemented any specific published algorithm.

## 3. Design — why our version is simpler than the general problem, honestly

We are **not** solving the hard, general fault-localization problem, and it would be overclaiming to say we are. The general problem is hard because the root cause isn't directly observable — you only see symptoms and have to infer backward.

In our system, the root cause *is* directly observable: `Verifier._divergence_point()` already computes the exact router where each flow's actual path first differs from its intended path (`Alert.responsible_router`). And our fault model (`faults/update_channel.py::UpdateChannel.apply()`) only ever targets **one** `router_id` per `RouteUpdate` — a fault always originates at exactly one router. Combine those two facts: if two flows both diverge at the same `responsible_router`, that is not a coincidence-prone heuristic guess — it's the same deterministic computation pointing at the same place twice. So the correct algorithm here is a simple, exact **grouping** operation, not a probabilistic or NP-hard inference:

```
correlate(alerts) = group alerts by responsible_router
                    → each group of size > 1 is one shared root cause,
                      naming all affected flows instead of N separate alerts
                    → each group of size 1 passes through unchanged
```

This is deliberately less sophisticated than Sherlock/SCORE — and that's the honest, correct call for this system, not a shortfall. Building minimal-hitting-set inference for a signal we already have exactly would be solving a harder problem than the one that exists here (see `CLAUDE.md` §37, don't overengineer). If a future version of this system stopped exposing an exact `responsible_router` per flow (e.g. if evidence became noisy/partial), that's when the harder inference algorithm would actually earn its complexity — not before.

## 4. What this buys us

- A judge-facing story that's honestly differentiated: not just "we detect divergence," but "we detect it per-flow *and* correlate multiple detections back to one shared cause," which is closer to how a real NOC actually wants the information presented.
- A concrete, testable, deterministic algorithm — no fuzzy scoring, no invented confidence numbers (which `CLAUDE.md` explicitly warns against faking).

## 5. Implementation

**Status: Implemented (2026-09-05).** `verify/correlator.py::correlate(alerts) -> list[RootCauseReport]` implements exactly the grouping algorithm in section 3, keyed on `Alert.responsible_router`, preserving first-appearance order (dict insertion order) so output is deterministic for R13. `RootCauseReport` carries `responsible_router`, the full `alerts` list, and `flows`/`is_correlated` convenience properties.

`tests/test_correlator.py` (5 tests): two alerts at the same router correlate into one report; a lone alert passes through unchanged; alerts at different routers stay uncorrelated; a mixed case (2 alerts at router A, 1 at router B) produces exactly two reports with the right membership; an empty alert list produces no reports.

Demonstrated end-to-end in `scenarios/definitions.py::correlation_demo()` — named `correlation_demo()` rather than the `scenario_7_multi_flow_root_cause()` name originally proposed above, for consistency with Innovation 2's `remediation_demo()` naming, and deliberately excluded from `ALL_SCENARIOS`/`SCENARIO_BY_NUMBER` for the same reason: never mistaken for one of the six PS31-baseline scenarios. Two independent flows routed through the same router both suffer the identical `CORRUPT` fault shape, so both alerts deterministically name the same `responsible_router` — the exact fact the algorithm relies on, not a contrived coincidence.

Rendered by `cli/demo.py --correlation-demo` as a "Root Cause Analysis" panel whenever a report has more than one alert. `tests/test_repeatability.py::test_correlation_demo_is_repeatable` and `tests/test_cli_smoke.py::test_main_correlation_demo_runs_clean` extend R13 and the CLI smoke-test pattern to this feature. Full suite: 58/58 passing.

> **Resolved (2026-09-05):** an earlier version of this section claimed this implementation existed when it didn't (see `docs/STATUS.md` "Known gaps" history) — that was a `CLAUDE.md` §8/§35 violation. It's now built for real, with the file/test citations above matching the actual repo.

---

# Innovation 2: Closed-Loop Deterministic Remediation

**Status: Implemented (2026-09-05).** `verify/remediator.py::Remediator.remediate()`, tested in `tests/test_remediator.py` (6 tests), demonstrated end-to-end via `scenarios/definitions.py::remediation_demo()` and `python -m planesplit.cli.demo --remediation-demo`. Full suite: 51/51 passing. Deliberately kept out of `ALL_SCENARIOS`/`SCENARIO_BY_NUMBER` and out of `docs/REQUIREMENTS.md` — this is not one of R1–R13, and mixing it into either would blur the PS31 baseline with an added-value feature (`CLAUDE.md` §2).

## 1. Understand — what problem this actually solves

Today the system stops at detection: `Verifier.check()` returns an `Alert` with `responsible_router`, `expected_path`, and `actual_path`, and a human has to act on it. That's the correct scope for PS31's literal requirements (R1–R13 are about *verification*, not remediation — see `docs/REQUIREMENTS.md`), but it leaves an obvious next question sitting on the table: once we know exactly which router is wrong and what it should say instead, why does a person still have to type the fix in by hand? Reducing mean-time-to-repair (MTTR), not just mean-time-to-detect, is the natural next capability — and it's the same kind of "added-value, not baseline" feature as multi-flow correlation, so it belongs in this doc under the same discipline: not confused with R1–R13, not claimed as done until it's built.

## 2. Research — what already exists

- **Reconciliation control loops** (Kubernetes controllers, Terraform `apply`, intent-based networking's "observe actual vs. desired, then act to close the gap") are the closest real-world pattern: a controller repeatedly compares live state to declared intent and issues corrective writes when they differ.
- **Self-healing network products** (e.g. assurance/automation features in commercial SDN controllers) already do exactly this for classes of drift they can safely auto-correct, with escalation to a human for anything they can't confidently fix.

**Engineering inference, not a verified citation** (per `CLAUDE.md` §4): I'm not citing a specific paper or product doc here, just the well-known reconciliation-loop pattern common to the systems above.

## 3. Design — why our version is simpler than "self-healing AI" sounds

It would be easy to oversell this as "an AI agent that fixes outages." That framing is wrong for what this system can honestly support, for two reasons:

**First, the fix requires no inference at all.** `ControlPlaneManager` never lets the RIB itself be faulted — only `UpdateChannel.apply()` can put a wrong entry into a router's FIB (`control_plane.py`: "RIB is never faulted"). That means the *correct* answer for any alerted flow is already sitting, uncorrupted, in `network.routers[alert.responsible_router].rib[alert.flow]`. Remediation isn't "diagnose the problem and choose among possible fixes" — it's "read the value that was never wrong, and write it to the place that was."

**Second, the write-path requires no new mechanism.** `UpdateChannel.apply(update, fault, now)` takes the fault mode as a plain per-call argument — the channel holds no persistent per-router "this router is broken" state (confirmed by reading `faults/update_channel.py`: `_pending` only tracks scheduled delayed updates, nothing about ongoing corruption). So a "clean" corrective write is just one more `apply()` call made with `InjectedFault(mode=FaultMode.NONE)`. There's no fault to "clear" first — the next call simply doesn't request one.

So the actual algorithm is:

```
remediate(alert):
    correct_next_hop = network.routers[alert.responsible_router].rib[alert.flow]   # never faulted
    update = cpm.push_route(alert.flow, alert.responsible_router, correct_next_hop) # RIB rewrite, idempotent
    channel.apply(update, InjectedFault(mode=FaultMode.NONE), now)                  # the one clean FIB write
    verifier.push_legitimate_change(alert.flow, now)                                # don't let our own fix look like a new unexplained divergence
```

No LLM, no scored confidence, no branching over multiple candidate fixes — consistent with `CLAUDE.md` §24 (PS-critical logic must stay deterministic unless the PS itself calls for an LLM, which it doesn't here).

**The one genuine judgment call: don't auto-fix silently forever — and it turned out to need zero new code.** If something keeps re-writing a router's FIB after remediation (a persistent fault, or a rogue process bypassing the controller), a naive "auto-fix on every alert" system would keep silently patching it — hiding a real, ongoing problem from the operator. The design anticipated needing a bespoke retry-counter/escalation policy for this. Building it revealed that's unnecessary: `remediate()` calls `verifier.push_legitimate_change(alert.flow, now)`, which marks the repair instant as the flow's last known-good moment — exactly the same bookkeeping a normal legitimate route change gets. `Verifier.check()` doesn't know or care that the *previous* divergence was fixed by `Remediator` instead of a real controller update; it just applies its existing grace-window rule to whatever happens next. So a re-divergence within the grace window is tolerated (maybe it's transient), and one outside it raises a normal, un-swallowed `Alert` — for free, using a mechanism that already existed and was already tested (`test_verifier.py`). See `test_remediator.py::test_recorruption_within_grace_window_after_remediation_is_tolerated` and `::test_recorruption_after_grace_window_is_realerted_not_silently_swallowed`. No caller-side retry loop, no attempt counter — `Remediator` really is just the one-shot action in section 3's algorithm, nothing more.

## 4. What this buys us

- A judge-facing story that closes the loop: not just "we detect and explain divergence," but "we detect it, prove it with evidence, and correct it through the same architectural path a real controller update would use — never bypassing the RIB/FIB separation that's the whole point of PS31."
- Still fully deterministic and testable: no invented confidence scores, no fake "AI decided to fix this" narrative (`CLAUDE.md` §8/§25).
- Composes with Innovation 1 once that's actually built: a correlated multi-flow root cause becomes one remediation call per `responsible_router` instead of one per flow.

## 5. Implementation

- `verify/remediator.py::Remediator.remediate(alert, now) -> RemediationResult`, constructed with `(network, cpm, channel, verifier)`, implementing exactly the algorithm in section 3. `RemediationResult` carries the `alert` it responded to, `router_id`, `restored_next_hop`, and `fixed_at` — no bare "fixed" boolean, per `CLAUDE.md` §13.
- No bounded-retry/escalation code exists anywhere, in `Remediator` or its callers — see the revised section 3 above for why that turned out to be unnecessary. `remediate()` raises `ValueError` (not a silent no-op) if `alert.responsible_router` has no RIB entry for `alert.flow` at all — a broken alert reference, never a fixable divergence.
- `tests/test_remediator.py` (6 tests): fixes a CORRUPT fault and re-verification passes; fixes a DROP fault; remediating one flow doesn't disturb another flow's independent grace window (mirrors Scenario 5); raises on a missing RIB entry; a re-divergence within the grace window after remediation is tolerated; a re-divergence outside the grace window after remediation is re-alerted, not swallowed.
- `scenarios/definitions.py::remediation_demo()` — deliberately not named/numbered as a `scenario_N` and deliberately excluded from `ALL_SCENARIOS`/`SCENARIO_BY_NUMBER`, so it's never mistaken for one of the six PS31-baseline scenarios. Reuses Scenario 3's exact CORRUPT fault so the "before" state is the same divergence `test_scenario_3` already proves detectable.
- `cli/demo.py --remediation-demo`: renders the before/after probe rows through the existing PASS/TOLERATED/ALERT table, then a dedicated "Auto-Remediation Evidence" panel naming the alert responded to and the exact FIB write made — never a bare "fixed" message.
- `tests/test_repeatability.py::test_remediation_demo_is_repeatable` and `tests/test_cli_smoke.py::test_main_remediation_demo_runs_clean` extend R13's repeatability guarantee and the CLI smoke-test pattern to this feature.
- **Known limitation, found while writing the tests**: `Remediator` never removes a stale, narrower FIB entry a `CORRUPT` fault may have left behind under a different key (e.g. a leftover `10.0.2.0/25` entry after the correct `10.0.2.0/24` entry is restored) — it only ensures the correct entry exists, not that no incorrect one coexists with it. This happens to be invisible to the standard boundary probe (the leftover narrower prefix doesn't cover the boundary address), but a probe aimed elsewhere in the range could still observe it. `Remediator` has no way to know what a given fault mode actually wrote, so cleaning this up in general is out of scope here — documented as a known gap rather than silently ignored, consistent with `CLAUDE.md` §44.
