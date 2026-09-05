"""R13: the same scenario, run twice, must produce identical detection and
evidence — no reliance on wall-clock flakiness. Runs every shared scenario
definition (scenarios/definitions.py) twice and diffs the results field by
field, since ProbeResult holds an Alert (not directly comparable via ==
unless we compare its fields) rather than a plain value.
"""
from planesplit.scenarios.definitions import ALL_SCENARIOS


def _as_comparable(results):
    out = []
    for r in results:
        alert = r.alert
        alert_tuple = None
        if alert is not None:
            alert_tuple = (
                str(alert.flow),
                alert.responsible_router,
                alert.expected_path,
                alert.actual_path,
                alert.detected_at,
                alert.reason,
            )
        out.append((r.scenario, r.label, str(r.flow), r.at, r.intended, r.actual, r.status, alert_tuple))
    return out


def test_every_scenario_is_repeatable():
    for scenario_fn in ALL_SCENARIOS:
        first_run = _as_comparable(scenario_fn())
        second_run = _as_comparable(scenario_fn())
        assert first_run == second_run, f"{scenario_fn.__name__} produced different output on a second run"
