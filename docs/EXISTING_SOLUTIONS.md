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

## 3b. p4pktgen — automated P4 test-case generation (added citation, not previously sourced)
Cited in Gereltsetseg & Tejfel, "Some optimization possibilities in data plane programming," 13th Joint Conf. Mathematics and Computer Science, ELTE, 2020 (`docs/papers/gereltsetseg-tejfel-2020-data-plane-optimization.md`), which references A. Nötzli, V. Tech, A. Fingerhut, C. Barrett, P. Athanas, "p4pktgen: Automated Test Case Generation for P4 Programs," 2018. p4pktgen uses **symbolic execution** over a P4 program to automatically generate test packets that validate the program forwards traffic as intended on a real device. This is the same underlying idea as our own `verify/prober.py` (generate a probe, check it against intended behavior) — the difference is scale and rigor: p4pktgen symbolically covers a real P4 program's full behavior; our prober picks one boundary address per flow by hand-reasoned heuristic (see `docs/INNOVATION.md` §3 for why an even more exhaustive version of our own approach is one of the two innovation directions under consideration). **Note**: this paper itself is primarily about data-plane *performance* optimization (async compression, in-network caching, NFV offloading) — a different sub-problem from PS31's consistency-verification focus; p4pktgen is the one part of it directly relevant here, mentioned only in the paper's related-work section.

## 4. Gap Analysis & Inspiration for MVP
**The Gap:** Existing solutions either rely entirely on parsing static configs (which the Problem Statement explicitly forbids relying solely on) or require intercepting live, expensive hardware. 
**What we will reuse/borrow:**
1. **Unified Model:** We will model routers mathematically with separate `RIB` (Control Plane) and `FIB` (Data Plane) tables.
2. **Simulated Packet Traversal:** We will use active probing, but instead of physical packets, we will instantiate *simulated packet objects* in software.
3. **Automatic Test Packet Generation (ATPG) concepts:** We will generate specific IP probes that exercise the changed rules to prove divergence.
