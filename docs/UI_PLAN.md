# 3D UI & Visualization Plan (The "Packet Rider" Concept)

## 1. Overview and Vibe
To deliver a highly engaging, user-friendly demo that stands out to hackathon judges, the frontend will be a high-fidelity 3D experience inspired by games like *slowroads.io* and *Tron*. 

Instead of an abstract top-down network graph, the UI will be an immersive, atmospheric environment where the camera smoothly chases a packet traveling through the network.

## 2. Framework & Technology
* **Core 3D Engine:** Three.js
* **Implementation:** React Three Fiber (R3F)
* **Helper Libraries:** `@react-three/drei` (for AAA-quality features like Bloom lighting, environmental skyboxes, and smooth chase-cameras).
* **Why this tech:** Three.js is the industry standard for high-end web visuals (powering games like slowroads.io). R3F allows rapid prototyping using React components while maintaining raw WebGL performance.

## 3. Creative Execution
### The Environment
* **Routers/Nodes:** Represented as massive, glowing monoliths or high-tech server towers in a vast, dark digital landscape.
* **The Packet:** A glowing sphere of energy.
* **The Camera:** A smooth, third-person chase camera locked behind the packet as it travels down glowing fiber-optic highways.

### Visualizing the "PlaneSplit" (The Core Hackathon Problem)
The primary challenge is visualizing Control Plane (Intent) vs. Data Plane (Reality). We will use visual contrast:
1. **The Update (Control Plane Intent):** When a route is updated, the Control Plane projects a **green, holographic highway** showing the intended new path.
2. **The Divergence (Data Plane Reality):** If the Data Plane experiences a delayed or dropped update, the physical track does not align with the hologram. 
3. **The Climax:** The camera follows the packet to an intersection. Judges visually see the packet ignore the green holographic intent and veer violently onto a **red-glowing track** (the old, broken Data Plane route), ultimately crashing into a dead end (a packet drop).

## 4. Frontend-Backend Integration Architecture
The system will use a decoupled Client-Server architecture to ensure the technical simulation (Python) remains purely algorithmic, as required by the problem statement.

1. **Backend (Python):** Runs the core `Network`, `Router` (RIB/FIB), and `ConsistencyVerifier` logic. 
2. **Real-Time Link (WebSockets):** The Python backend streams discrete state events to the frontend.
   * *Example Payload:* `{"event": "packet_dispatch", "intended_path": ["A", "C"], "actual_path": ["A", "B", "DROP"], "status": "diverged"}`
3. **Frontend (R3F):** Listens to WebSocket events and triggers the corresponding 3D animations, camera movements, and environmental color changes.

## 5. Judge Interactivity
To avoid the "black-box" smoke-and-mirrors critique, the UI will include an overlay dashboard (built with standard HTML/CSS over the WebGL canvas). This dashboard allows judges to:
* Trigger route updates manually.
* Adjust the injected delay time via a slider (e.g., 0ms for perfect sync, 2000ms for massive divergence).
* Inject specific hardware faults (like a `/25` mask corruption) and watch the 3D world react.
