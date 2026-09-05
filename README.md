# PlaneSplit (PS31)

Control-plane and data-plane consistency verification: a pure-software model
of a small network where each router's control-plane intent (RIB) and
data-plane forwarding state (FIB) are genuinely independent structures,
connected only through a fault-injectable Update Channel. Simulated packet
probes trace both the intended and actual forwarding paths and a verifier
flags any mismatch that persists beyond a declared propagation grace window.

See `ps.md` for the full problem statement and `docs/` for architecture,
requirements traceability, and the test plan.

## Setup

```bash
pip install -r planesplit/requirements.txt
```

## Run tests

```bash
pytest planesplit/tests/
```

## Run the demo

```bash
python -m planesplit.cli.demo --all          # every scenario
python -m planesplit.cli.demo --scenario 3   # a single scenario by its docs/TEST_PLAN.md number (1-6)
```

Output is a color-coded table (PASS / TOLERATED / ALERT per probe) followed
by full evidence for any alert raised: the affected flow, the responsible
router, and both the intended and actual paths.

## Reset

There is nothing to reset. The demo and every test build a fresh, in-memory
topology from scratch on each run — no persisted state, no database, no
setup/teardown step. Re-running the command above *is* the reset, and it is
deterministic: the same scenario produces byte-identical output every time
(see `tests/test_repeatability.py`).

## Project status

See `docs/STATUS.md` for what's implemented, tested, and what's next.
