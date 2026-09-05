# Minimum Viable Product (MVP)

## 1. Goal
Build the smallest technically strong prototype that fully satisfies the Problem Statement without overengineering. The MVP focuses on correctness, algorithmic verification, and clear demonstrability over visual flashiness.

## 2. Scope & Features
- **Topology:** A simple 3-to-5 node network (e.g., A -> B -> C, with an alternate path A -> D -> C).
- **Data Structures:** Custom Python classes for `Router`, `Network`, and `Packet`.
- **Forwarding Logic:** IPv4 Longest Prefix Match (LPM).
- **Fault Injector:** A module capable of wrapping FIB updates to introduce:
  - *Delay:* Update applied after $X$ seconds.
  - *Loss:* Update completely dropped (simulating a silent hardware failure).
  - *Partial Application:* Wrong subnet mask applied (e.g., `/25` instead of `/24`).
- **Probing Engine:** Generates a simulated packet destined for the modified prefix and traces it through both CP and DP logic.

## 3. Exclusions (What we will NOT build)
- No physical Mininet, OpenFlow, or P4 switches. (PS states: "pure software model").
- No complex dynamic routing protocols (BGP/OSPF implementation). We will manually define the intended CP routes for simplicity.
- No heavy Web UI. A clear, color-coded CLI output is far more reliable for verifying mathematical routing correctness during a hackathon demo.

## 4. Key Metric for Success
The MVP must be able to accurately state: *"Packet to 10.0.1.5 was expected to take path A->B->C, but actually took A->D (Blackholed) due to data-plane divergence on node A."*


## 360° Jury View & Agent Comments
> **Technologist Jury Comment:** While the MVP is tightly scoped, be prepared to answer scaling questions during the Q&A. How does this pure Python Longest-Prefix-Match (LPM) scale from 4 nodes to a topology of 4,000 nodes? We should ensure the algorithm is cleanly written to allow future optimization (e.g., transitioning from a linear search to a Radix/Trie tree structure).
>
> **Resolved:** at MVP scale (3–5 nodes, a handful of routes each) `Router.forward()` does a plain linear scan over `RIB`/`FIB` entries sorted by prefix length using Python's built-in `ipaddress` module — correct and fast enough, no data structure work needed now. For the Q&A answer: the LPM check is isolated inside a single method (`Router.forward()`, frozen in `BUILD_PLAN.md` §0), so swapping the linear scan for a Radix/Patricia trie later is a localized change, not a redesign — we're not scaling to it now because nothing in `REQUIREMENTS.md` asks for it, and CLAUDE.md §37 explicitly warns against building for hypothetical scale the PS doesn't require.
