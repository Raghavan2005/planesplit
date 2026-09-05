# Decision Log

## Final choice: PS31 — PlaneSplit

Full text of all options: [PROBLEM_STATEMENTS.md](PROBLEM_STATEMENTS.md).

## How we got here

1. **Initial single-pass recommendation**: PlaneSplit (PS31), on the basis that its pass/fail is provable by literally tracing a packet through the system rather than trusting a self-designed integrity or statistical scheme, and that its real-world analog (control-plane/data-plane drift) is a widely recognized class of production outage.

2. **Independent 3-judge panel**, each given the same three problem statements with no visibility into the others' verdicts or the initial recommendation:

   | Judge | Lens | Verdict | Core reasoning |
   |---|---|---|---|
   | 1 | Technical feasibility | PS81 | PlaneSplit's propagation-window timing semantics are easy to get subtly wrong under time pressure; PipelineTrust is a cleaner integrity/diffing build with an unambiguous pass/fail. |
   | 2 | Real-world impact | PS31 | Control-plane/data-plane drift is a documented, recurring outage class (SDN fabrics, K8s NetworkPolicy lag, BGP convergence) with a real commercial tooling gap (Batfish, Forward Networks). PipelineTrust felt like reinventing existing log-integrity patterns (Kafka exactly-once, checksums). |
   | 3 | Novelty / demo strength | PS81 | Has a built-in three-act visual (ground truth → silent tampering → live reconciliation) that's legible without domain expertise; PlaneSplit reads as a networking-lab exercise on screen. |

   Panel result: **2–1 for PS81**, but Judge 2's dissent squarely echoed the original PS31 recommendation.

3. **Final call**: user reviewed the full tradeoff (feasibility risk vs. real-world pain-point strength) and chose to proceed with **PS31 — PlaneSplit**, accepting the timing-window implementation as the main risk to manage carefully during the build.

## Why PS31, on balance

- Pass/fail is provable with an actual simulated packet trace — the strongest, least arguable demo mechanic of the three options.
- Real-world analog is broad and instantly recognizable to technical judges: Kubernetes NetworkPolicy propagation lag, SDN controller/switch flow-table drift, BGP route convergence delay, service-mesh (Istio/Envoy) config staleness.
- Matches an existing commercial category (network intent verification: Batfish, Forward Networks, Intentionet), which supports a credible "why this matters" pitch.
- Main acknowledged risk: the propagation-window / convergence-timing logic must be implemented carefully so the demo doesn't hinge on a flaky edge case. See [BUILD_PLAN.md](BUILD_PLAN.md) for how this is scoped down.
