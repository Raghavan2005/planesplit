# Future Vision — AI-Assisted Recommendation Layer (NOT IMPLEMENTED)

> **Status: Vision only. Nothing in this document exists in the codebase.** This is written up so a verbal answer given live to the jury has an honest, on-record counterpart — not to claim it as built, planned-for-this-submission, or in progress. Do not cite anything here as a feature of the current MVP. See `docs/INNOVATION.md` for what's actually built beyond the PS31 baseline (both of those are real, tested, and cited with file paths).

## 1. Where this came from

In jury Q&A, asked where this system would be implemented on real infrastructure, the answer given went further than the verification MVP: that the system could analyze a network's history and recommend better paths/configuration going forward, specifically tuned for AWS (since myOnsite HealthCare — the sponsor — runs on AWS), and that an AI agent could generate those recommendations with hallucination risk handled via multiple models cross-checking each other, RAG over recorded data, and a final human review.

That's a legitimate direction to sketch verbally, but it's a materially different system from the one that's built and tested here — PS31 and everything in `planesplit/` is *detection* (prove a divergence exists), not *prescription* (recommend what to do about future traffic). Writing it down here does two things: keeps the story consistent with what was said, and forces the same honesty discipline this project already applies elsewhere (`CLAUDE.md` §8/§44) onto an idea that was proposed live, under pressure, without that check.

## 2. The idea, stated properly

A recommendation layer that sits **on top of** the verification core (not replacing it), consuming the evidence the verifier and correlator already produce — `Alert`, `RootCauseReport`, remediation history — plus real infrastructure telemetry, to suggest configuration or routing changes a human operator could apply.

## 3. The AWS-specific piece — the part worth keeping

The most concrete, technically defensible part of the live answer was tying this to AWS, and it maps cleanly onto the RIB/FIB model already built here:

| This project's concept | AWS equivalent |
|---|---|
| RIB (control-plane intent) | AWS Route Tables, Transit Gateway route propagation |
| FIB (data-plane reality) | Actual observed traffic — VPC Flow Logs, or a point-in-time check via VPC Reachability Analyzer |
| `Verifier.check()` | Diffing declared Route Table state against what Flow Logs / Reachability Analyzer actually show |
| `correlate()` | Grouping divergent flows by the shared route table entry or Transit Gateway attachment responsible |

This is a genuinely fair claim to make: *the RIB/FIB verification pattern this project proves out in simulation has a direct, named AWS equivalent* — Route Tables vs. Flow Logs is a real, inspectable pair of "intended" and "actual" state in exactly the shape this project already models. That's different from, and more defensible than, "we can optimize your AWS setup."

## 4. Recommendation generation — and the honesty problem it raises

This is where the live answer got weaker, and needs correcting here rather than repeated as-is next time:

- **"Multiple LLMs verify the answer" is not, by itself, a hallucination fix.** Models trained on overlapping data can agree on the same wrong answer — consensus across LLMs is not the same as correctness, and presenting it as though it were would be exactly the kind of unverified AI-output trust `CLAUDE.md` §25 warns against for this project.
- **RAG is the actually defensible half of the answer, and should lead, not follow.** Grounding any generated recommendation in retrieved, real, recorded evidence (the verifier's own `Alert`/`RootCauseReport` history, real AWS telemetry) rather than model memory is a legitimate, standard mitigation — it constrains the model to cite specific recorded evidence rather than free-associate.
- **Final human review before anything is acted on is the actual trust boundary**, not the multi-model step. That part of the live answer was right and should stay the headline, not an afterthought.

Restated properly, in the same spirit as `CLAUDE.md` §24 (which already governs this project's stance on AI): *any LLM in this layer would only ever explain or summarize evidence the deterministic verifier already computed — flow, responsible router, expected vs. actual path, timing — never invent new evidence or new "the network is broken because X" claims unsupported by that evidence.* The verification core stays deterministic and LLM-free exactly as it is today; an AI layer, if built, sits strictly downstream of it, constrained to citing what the deterministic evidence already proved.

## 5. What would actually need to be built (none of this exists)

- A telemetry-ingestion layer for real infra evidence (AWS Route Tables + VPC Flow Logs, in the concrete case above) — a real analogue to this project's simulated `Network`/`UpdateChannel`, since none of `planesplit/`'s current code touches any real cloud API.
- A retrieval index over recorded `Alert`/`RootCauseReport`/remediation evidence for the RAG step to ground against — nothing here persists evidence today; `planesplit/` is entirely in-memory and stateless between runs (`docs/ARCHITECTURE.md` §5).
- The recommendation-generation step itself, with output schema validation and evidence-citation checking before anything reaches a human (`CLAUDE.md` §25: validate JSON schema, allowed values, references to real system data, confidence, hallucination risk).
- A human-review/approval UI or workflow — there is currently no persistence layer or review queue of any kind.

## 6. Why this is filed separately from `docs/INNOVATION.md`

`docs/INNOVATION.md` already had one real integrity failure this project caught and fixed — a feature described as implemented that wasn't (see `docs/STATUS.md`). Keeping unbuilt vision in its own clearly-labeled document, rather than folding it into the doc that tracks real, tested, added-value features, is a direct, deliberate response to that lesson: never let a "here's where this could go" idea sit in the same document as "here's what we proved works," where the two are easy to conflate.

## 7. Related documentation-only infrastructure runbooks

Two further optional, documentation-only runbooks exist alongside this vision doc, kept just as clearly separated from "what's actually built": `docs/AWS_INFRASTRUCTURE_SETUP.md` and `docs/GCP_INFRASTRUCTURE_SETUP.md` are raw CLI (`aws`/`gcloud`) command sequences for standing up the real network infrastructure (VPC, load balancing, and — for AWS — Global Accelerator / — for GCP — a Global External Application Load Balancer, which is inherently anycast without a separate accelerator resource) that Section 3 above ties to this project's RIB/FIB model. Both are unexecuted, unconnected to the simulator, and cost real money to actually run. Their own appendices/Section 5s restate the four conceptual agent roles (monitoring, policy, optimization, security) named in Section 1's jury answer, mapped to the concrete AWS and GCP services each would be built on — still nothing built, same as everything else in this document.
