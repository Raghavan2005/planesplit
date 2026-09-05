# Production-Level Code Review Report

> **Staleness callout (2026-09-06):** this review predates both the `516afea` rewrite that replaced `backend/network.py` with a wrapper over the tested `planesplit` engine, and the backend hardening pass tracked in `docs/STATUS.md`. Point-by-point status as of now:
> - ✅ **Resolved:** input validation (`backend/schemas.py` + `backend/dispatch.py::handle_action`, Pydantic-validated, no more bare `cmd["action"]`/`KeyError` risk), dead-connection handling (`broadcast_snapshot`/`_broadcast` in `backend/main.py` now proactively drop any socket whose `send_json` raises, within the same call).
> - ✅ **Resolved (predates this pass, via `516afea`):** `backend/network.py` no longer exists — `backend/state.py` imports the real, tested `planesplit.core`/`planesplit.faults`/`planesplit.verify` classes directly. "Missing Tests" for LPM is also resolved this way: LPM is tested in `planesplit/tests/test_core.py`, not reimplemented in `backend/`.
> - ⚠️ **Partially resolved:** frontend reconnection logic exists today (a fixed 2s retry) but not yet with exponential backoff — tracked as part of the in-progress frontend pass in `docs/STATUS.md`.
> - ❌ **Still real, not yet addressed by any pass:** global singleton state (`Session-Based State`) — no per-session isolation between browser connections; monolithic `App.tsx` (now ~1200 lines, not 400 — actively being split as part of the in-progress frontend pass); hardcoded topology/3D layout (`Users`/`Firewall`/`Server`/`AWS_ALB` and their positions are still fixed, not dynamically configurable — this is a deliberate scope choice for the current PS31 demo, not an oversight, but is worth naming here since this review flagged it as a gap).
>
> The rest of this document is kept as the original review for historical record — read it with the corrections above in mind, not as current state.

Below is the code review analyzing the current hackathon MVP implementation against strict "Production-Level" software engineering standards. 

## 1. Backend (`backend/main.py` & `backend/network.py`)

### 🔴 Critical Production Gaps
* **Global State Management:** The `SimulationState` and `clients` list are global singletons. In a production environment with multiple users, every connected user shares and mutates the exact same network state. Production requires session-based or database-backed state isolation.
* **Input Validation:** The WebSocket listener uses `cmd = json.loads(data)` and assumes `cmd["action"]` exists. If a malformed payload is received, a `KeyError` will crash the WebSocket loop. Production requires schema validation (e.g., **Pydantic** models).
* **WebSocket Connection Handling:** The `broadcast()` function uses a naked `except:` block. If a client disconnects unexpectedly, it silently ignores the error without logging, and the dead connection remains in the `clients` list until the next broadcast attempt fails. 

### 🟡 Architecture & Maintainability
* **Hardcoded Topology:** The `Users`, `Firewall`, `Server`, and `AWS_ALB` nodes, alongside their `/24` subnets, are hardcoded in `setup_baseline()`. A production tool must be dynamically configurable via YAML/JSON or a database.
* **Missing Tests:** The codebase lacks unit tests for the Longest Prefix Match (LPM) logic in `network.py`.

### 🟢 Strengths
* Separation of `RIB` (Intended) and `FIB` (Actual) cleanly models real-world SDN controllers.
* `ipaddress` usage is mathematically sound for routing logic.

---

## 2. Frontend (`frontend/src/App.tsx`)

### 🔴 Critical Production Gaps
* **Monolithic Architecture:** Everything (3D logic, UI overlay, WebSocket client, physics calculations) is crammed into a single 400-line `App.tsx` file. Production React requires strict component separation (e.g., `components/3D/ServerRack.tsx`, `components/UI/Dashboard.tsx`, `hooks/useSimulationSocket.ts`).
* **Missing Reconnection Logic:** If the Python backend crashes or the network drops, the `WebSocket` closes and never attempts to reconnect. The user is left with a frozen UI and no error message. Production requires exponential backoff reconnection (e.g., using `react-use-websocket`).

### 🟡 Performance & Rendering
* **Hardcoded 3D Layout:** `NODE_POSITIONS` is hardcoded. If the backend sends a new router, it will not render. Production requires a dynamic graph layout algorithm (like D3 Force Layout) to automatically position arbitrary network topologies.
* **Memory Management:** Inside the `Packet` and `ServerRack` components, we are generally safe, but `THREE.Vector3` objects inside the `PathLine` are instantiated on every render cycle. In high-traffic scenarios, this causes excessive Garbage Collection (GC) stutter.

### 🟢 Strengths
* High-fidelity visuals using `React Three Fiber` and `@react-three/postprocessing` (Bloom).
* `useFrame` is utilized correctly for smooth 60fps animations without triggering expensive React state re-renders.
* Clean glassmorphism UI design.

---

## Summary Verdict
The codebase is a **brilliant, highly-polished Hackathon MVP**. However, it is **not production-ready**. Before deploying this to real users, it requires a major refactor to introduce input validation, session isolation, component splitting, and dynamic topology rendering.
