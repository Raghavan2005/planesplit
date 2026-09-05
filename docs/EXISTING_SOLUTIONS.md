# Existing Solutions & Gap Analysis

## 1. Academic Foundations
- **Header Space Analysis (HSA):** A formal verification framework that models packet headers as points in a geometric space. Devices are mathematical functions that transform these spaces. It statically verifies state to find loops and reachability failures.
- **NetKAT:** A domain-specific language built on Kleene Algebra with Tests, treating network programs mathematically to bridge control-plane logic and data-plane forwarding.

## 2. Commercial & Open-Source Tools
- **Batfish:** Parses vendor-specific configurations into a unified model. It simulates control plane protocols and computes the data plane to answer "what-if" questions using a Query Framework (Static Analysis).
- **Veriflow (VMware) / Forward Networks:** These Intent-Based Networking platforms log into live devices to collect actual data plane operational state (MAC/FIB, ACLs). They build a "digital twin" mathematical model and formally prove if this state matches user-defined intents.

## 3. Active Probing vs. Static Analysis
- **Static Analysis (Config diffing / Modeling):** Non-invasive, examines config files. Might miss hidden hardware failures or silent rejections that aren't reflected in the configuration strings.
- **Active Probing (Data Plane Verification):** Injects synthetic test packets (ping, traceroute) to test real routing. Highly accurate to transient conditions.

## 4. Gap Analysis & Inspiration for MVP
**The Gap:** Existing solutions either rely entirely on parsing static configs (which the Problem Statement explicitly forbids relying solely on) or require intercepting live, expensive hardware. 
**What we will reuse/borrow:**
1. **Unified Model:** We will model routers mathematically with separate `RIB` (Control Plane) and `FIB` (Data Plane) tables.
2. **Simulated Packet Traversal:** We will use active probing, but instead of physical packets, we will instantiate *simulated packet objects* in software.
3. **Automatic Test Packet Generation (ATPG) concepts:** We will generate specific IP probes that exercise the changed rules to prove divergence.
