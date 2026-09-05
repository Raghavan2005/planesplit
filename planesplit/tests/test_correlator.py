"""Tests for verify/correlator.py — see docs/INNOVATION.md "Innovation 1"."""
from ipaddress import IPv4Network

from planesplit.verify.correlator import correlate
from planesplit.verify.verifier import Alert

FLOW_1 = IPv4Network("10.0.2.0/24")
FLOW_2 = IPv4Network("10.0.3.0/24")
FLOW_3 = IPv4Network("10.0.4.0/24")


def _alert(flow: IPv4Network, responsible_router: str) -> Alert:
    return Alert(
        flow=flow,
        responsible_router=responsible_router,
        expected_path=["A", responsible_router, "C"],
        actual_path=["A"],
        detected_at=1.0,
        reason="synthetic alert for correlator testing",
    )


def test_two_alerts_at_the_same_router_are_correlated_into_one_report():
    alerts = [_alert(FLOW_1, "A"), _alert(FLOW_2, "A")]
    reports = correlate(alerts)
    assert len(reports) == 1
    assert reports[0].responsible_router == "A"
    assert reports[0].is_correlated
    assert reports[0].flows == [FLOW_1, FLOW_2]


def test_a_lone_alert_passes_through_unchanged():
    alerts = [_alert(FLOW_1, "A")]
    reports = correlate(alerts)
    assert len(reports) == 1
    assert reports[0].responsible_router == "A"
    assert not reports[0].is_correlated
    assert reports[0].alerts == alerts


def test_alerts_at_different_routers_stay_uncorrelated():
    alerts = [_alert(FLOW_1, "A"), _alert(FLOW_2, "B")]
    reports = correlate(alerts)
    assert len(reports) == 2
    assert {r.responsible_router for r in reports} == {"A", "B"}
    assert all(not r.is_correlated for r in reports)


def test_three_alerts_two_at_one_router_one_at_another():
    alerts = [_alert(FLOW_1, "A"), _alert(FLOW_2, "B"), _alert(FLOW_3, "A")]
    reports = correlate(alerts)
    assert len(reports) == 2
    by_router = {r.responsible_router: r for r in reports}
    assert by_router["A"].is_correlated
    assert by_router["A"].flows == [FLOW_1, FLOW_3]
    assert not by_router["B"].is_correlated


def test_empty_alert_list_produces_no_reports():
    assert correlate([]) == []
