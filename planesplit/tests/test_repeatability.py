"""R13: the same scenario, run twice, must produce identical detection and
evidence — no reliance on wall-clock flakiness. Runs every shared scenario
definition (scenarios/definitions.py) twice and diffs the results field by
field, since ProbeResult holds an Alert (not directly comparable via ==
unless we compare its fields) rather than a plain value.
"""
from planesplit.scenarios.definitions import ALL_SCENARIOS, correlation_demo, remediation_demo


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


def test_remediation_demo_is_repeatable():
    """R13 also applies to the added-value remediation demo, not just the
    PS31-baseline scenarios in ALL_SCENARIOS."""
    first_results, first_remediation = remediation_demo()
    second_results, second_remediation = remediation_demo()
    assert _as_comparable(first_results) == _as_comparable(second_results)
    assert (first_remediation.router_id, first_remediation.restored_next_hop, first_remediation.fixed_at) == (
        second_remediation.router_id,
        second_remediation.restored_next_hop,
        second_remediation.fixed_at,
    )


def test_correlation_demo_is_repeatable():
    """R13 also applies to the added-value correlation demo."""
    first_results, first_reports = correlation_demo()
    second_results, second_reports = correlation_demo()
    assert _as_comparable(first_results) == _as_comparable(second_results)
    assert [(r.responsible_router, [str(f) for f in r.flows]) for r in first_reports] == [
        (r.responsible_router, [str(f) for f in r.flows]) for r in second_reports
    ]
