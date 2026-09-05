# Problem Statement Options

Three problem statements were offered for this hackathon. Each is noted as "permanently assigned — cannot be changed" once selected.

**Selected: Option 1 — PS31 PlaneSplit** (see [DECISION.md](DECISION.md) for reasoning).

---

## Option 1 — PS31: PlaneSplit
**Control-Plane and Data-Plane Consistency Verification**

A network control plane can claim that forwarding intent has changed while the data plane continues handling traffic according to old state. Design a pure software model of a small network in which one component exposes intended forwarding rules and another executes packet forwarding from an independently maintained rule set. Inject delayed, lost, or partially applied updates and determine when the observed forwarding behavior is no longer a valid implementation of the current control-plane intent, while tolerating a declared short propagation window after legitimate changes. The system must identify the specific flow or destination affected and verify the practical consequence with simulated packets, rather than merely diffing two configuration files.

A convincing demonstration should include one normal delayed update that converges within the allowed window and one injected divergence that persists beyond it, with repeatable packet probes proving the latter violates the intended path. No programmable switch or physical networking hardware is required.

---

## Option 2 — PS81: PipelineTrust
**Security Telemetry Aggregation Integrity Verification**

Security monitoring depends on events collected by many individually honest agents being correctly aggregated and forwarded to a central analysis system, but the aggregation layer sitting between the agents and that central view can itself drop, delay, or alter events without any agent doing anything wrong, meaning the picture a security team ultimately sees can differ meaningfully from what was actually observed at the source, without any obvious sign that this has happened.

Design a system that compares what simulated agents actually observed and sent against what the central aggregation layer ultimately delivered, and identifies specific discrepancies introduced during aggregation, reconstructing the true picture the agents originally reported. A convincing demonstration should introduce a silent dropping or alteration of events during aggregation, and show the system correctly identifying the discrepancy and reconstructing what the agents actually observed.

---

## Option 3 — PS131: EphemeralLeak
**Bounded Side-Channel Search for Cross-Session Identity Linkage**

Short-lived identities can be unlinkable at the credential layer yet still become linkable through other observable session properties. To keep the challenge objective, the evaluation declares a finite side-channel space such as timing bucket, reused resource identifier, request-size pattern, and persistent client configuration. Design a system that analyzes simulated sessions carrying fresh ephemeral identities, systematically tests the declared channels for evidence that two sessions can be linked above a defined confidence threshold, and changes session behavior to close any confirmed channel while preserving normal service. The system must not search arbitrary external data or use narrative guesses.

The evaluation includes one seeded correlation channel, one tempting but non-causal coincidence, and multiple unrelated users with similar timing. A convincing demonstration should identify only the seeded channel, apply a correction, and show that the same linkage test falls below the threshold afterward while legitimate sessions remain usable.
