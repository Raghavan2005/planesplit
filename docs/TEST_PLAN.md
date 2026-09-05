# Test & Verification Plan

## 1. Objective
Prove that the system can reliably distinguish between a transient, acceptable delay (within a propagation window) and a genuine, persistent divergence, using simulated packets.

## 2. Test Scenarios

### Scenario 1: Normal Delayed Update (Convergence)
- **Setup:** Initial route exists.
- **Action:** Control plane updates a route. The fault injector applies a 1.0-second delay to the FIB update. We declare a 2.0-second propagation window.
- **Verification:**
  - Send a packet probe immediately ($T=0.1s$). Verify it follows the old path (Mismatch detected, but ignored as it's within the window).
  - Send a packet probe at $T=1.5s$. Verify it follows the new path.
- **Result:** System reports successful convergence.

### Scenario 2: Injected Divergence (Lost Update)
- **Setup:** Initial route exists.
- **Action:** Control plane updates a route. The fault injector completely drops the FIB update. We declare a 2.0-second propagation window.
- **Verification:**
  - Probe at $T=0.5s$ (Mismatch, within window).
  - Probe at $T=2.5s$ (Mismatch, window expired).
- **Result:** System throws an alert, identifying the specific flow and the incorrect actual path taken.

### Scenario 3: Partial Application / Rule Corruption
- **Setup:** Control plane intends to route `10.0.2.0/24` to Node C.
- **Action:** Fault injector corrupts the FIB update, writing `10.0.2.0/25` instead.
- **Verification:**
  - ATPG logic generates a probe for `10.0.2.200` (which falls in the `/24` but outside the `/25`).
  - System simulates the probe.
- **Result:** Probe drops or takes default route. System detects divergence.

### Scenario 4: True Negative (Steady State, No Change)
- **Setup:** Initial route exists and is fully converged — every router's RIB and FIB already agree.
- **Action:** No control-plane update is issued at all during the test window.
- **Verification:**
  - Fire probes continuously at several timestamps (e.g. $T=0.5s$, $T=2.0s$, $T=5.0s$) with no route change in between.
  - Every probe must show intended path == actual path.
- **Result:** System reports zero alerts across the entire run. This is the baseline that proves the verifier isn't alerting by default or on a timer — it only reacts to genuine mismatch. Any alert firing here is a critical bug (a detector that cries wolf on steady state is worthless), so this scenario should run first in the suite and gate all others.

### Scenario 5: False-Positive Attempt (Legitimate Coincidental Delay)
- **Setup:** Same as Scenario 1, but the delay is deliberately chosen to sit right at the edge of suspicion: a *second*, unrelated route update on a *different* flow/destination is issued a moment later on the same router, so two mismatches are visible in the trace at once.
- **Action:** Control plane updates Flow X (delay 1.0s, resolves at 1.0s) and, independently, Flow Y (delay 0.3s, resolves at 0.3s) on the same router, both inside a 2.0s grace window. Neither is dropped or corrupted — both are legitimate, merely temporally overlapping changes.
- **Verification:**
  - Probe both flows at $T=0.5s$: both mismatch, both still inside their own grace windows.
  - Probe both flows at $T=1.5s$: both now match.
  - Confirm the verifier evaluated each flow's grace window **independently** (per ARCHITECTURE.md §2D — grace-window state is tracked per flow/destination, not globally) and did not, for example, let Flow Y's earlier resolution mask Flow X's still-pending one, or let Flow X's later change extend Flow Y's window.
- **Result:** No alert for either flow. This is the case most likely to trip up a naive detector that tracks only one global "last change" timestamp instead of per-flow state — passing it is the real proof that the system distinguishes "multiple legitimate concurrent changes" from "an attack dressed up as ordinary churn."

### Scenario 6: Route Flapping (Rapid Repeated Legitimate Changes)
- **Setup:** Initial route for `10.0.3.0/24` points to Node B, fully converged.
- **Action:** Control plane issues 5 legitimate route changes for the *same* flow within a 2.0-second window (e.g. B → D → B → C → D, each change arriving ~0.4s apart), simulating real-world route flapping (the same phenomenon BGP route flap damping, RFC 2439, exists to handle). None of these updates are dropped or corrupted — each is a genuine, if rapid, legitimate change, and the grace window resets on each one.
- **Verification:**
  - After each of the 5 changes, probe immediately: mismatch is expected and must be tolerated (inside that change's own fresh grace window) — never an alert mid-flap.
  - Confirm `push_legitimate_change()` **overwrites** `last_legitimate_change_at` on every call rather than setting it only once — this is the specific bug this scenario exists to catch (see `BUILD_PLAN.md` §0, the shared interface contract's explicit warning about this).
  - Probe at $T=2.5s$ (2.0s after the *last* of the 5 changes, all still within its own grace window): must still be tolerated, not alerted, since the window is measured from the most recent legitimate change, not the first.
  - Probe at $T=4.5s$ (2.0s after the last change's window has genuinely expired, with no further changes): must now show converged (PASS), matching the final route (D).
- **Result:** Zero alerts throughout the entire flapping sequence, and the final probe correctly reflects only the last route issued — proving the verifier tracks "most recent legitimate change" per flow rather than getting confused by, or averaging across, rapid churn.

## 3. Success Criteria
No false positives during the acceptable propagation window, including under concurrent/overlapping legitimate changes (Scenario 5) and rapid repeated changes to the same flow (Scenario 6). Zero alerts during steady state with no changes at all (Scenario 4). 100% detection rate of injected persistent faults using packet tracing, rather than just string-comparing the RIB and FIB lists.


## 360° Jury View & Agent Comments
> **SRE/QA Jury Comment:** The test plan needs a 'Chaos' scenario. Real networks don't just delay single updates; they experience rapid 'route flapping'. We must add a test where a route rapidly changes 5 times within a 2-second window to prove our verifier accurately tracks the final state without throwing false positives during the churn.
>
> **Resolved:** added as Scenario 6 above.
