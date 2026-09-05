# Demonstration Strategy

## 1. Narrative Flow
The demo will be a self-contained, automated CLI script that walks the judges through the exact requirements of the Problem Statement, challenging our own assumptions at every step.

## 2. Step-by-Step Demo Execution

### Phase 1: Baseline
- Spin up a 4-node network.
- Establish initial intended routes.
- Fire initial probes to prove CP and DP are synchronized.

### Phase 2: The Legitimate Change (Transient Inconsistency)
- *Narrative:* "We update the network and declare a 2-second propagation window."
- **Action:** Inject an update with a 1-second delay.
- **Live Output:** We will stream packet probes every 0.5 seconds to the console.
  - Probe 1 (0.5s): ❌ DIVERGED (Expected, inside window)
  - Probe 2 (1.0s): ❌ DIVERGED (Expected, inside window)
  - Probe 3 (1.5s): ✅ CONVERGED (Route updated)
- *Conclusion:* System correctly tolerated the short propagation window.

### Phase 3: The Persistent Divergence (Lost Update)
- *Narrative:* "Hardware silently fails to apply the next update."
- **Action:** Inject an update, but drop it for the Data Plane FIB.
- **Live Output:** 
  - Probes continue to fire during the 2-second window.
  - Window expires at $T=2.0s$.
  - Probe at $T=2.5s$: ❌ DIVERGED.
- **Verification Output:** The script will halt and clearly print:
  ```
  ALERT: Divergence persists beyond allowed window!
  Affected Destination: 10.1.1.0/24
  Intended Path: A -> B -> D
  Actual Path:   A -> C (Dropped)
  ```
  
### Phase 4: Why this matters
- Emphasize that we didn't just `diff(config_a, config_b)`. We proved the failure by routing a *simulated packet* through the actual data plane state mathematically, fulfilling the core challenge of the Problem Statement.


## 360° Jury View & Agent Comments
> **Product/Presentation Jury Comment:** The demo narrative needs a 'hook'. Start the demo by stating the real-world business impact (e.g., stopping catastrophic cloud outages caused by silent data-plane failures). Furthermore, a wall of white terminal text will bore the judges. We must use a terminal styling library (like Python's 
ich) to draw color-coded topology graphs and path traces.
