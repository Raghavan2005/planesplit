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

`verify/correlator.py::correlate(alerts) -> list[RootCauseReport]`. See `tests/test_correlator.py` for the demonstrated cases: multiple flows correlated under one router, a lone alert passed through unchanged, and two alerts at *different* routers correctly staying uncorrelated. Demonstrated end-to-end in `scenarios/definitions.py::scenario_7_multi_flow_root_cause()` and rendered by `cli/demo.py` as a "Root Cause Analysis" section whenever more than one alert shares a router.
