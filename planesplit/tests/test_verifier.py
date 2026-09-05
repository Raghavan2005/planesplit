"""Isolated unit tests for verify/verifier.py (M3), no network/routing involved."""
from ipaddress import IPv4Network

from planesplit.faults.update_channel import UpdateChannel
from planesplit.verify.verifier import Verifier

FLOW = IPv4Network("10.0.2.0/24")


def test_check_returns_none_when_paths_match():
    v = Verifier()
    assert v.check(FLOW, ["A", "B", "C"], ["A", "B", "C"], now=0.0) is None


def test_check_tolerates_mismatch_inside_grace_window():
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=1.0)
    assert alert is None


def test_check_alerts_after_grace_window_elapses():
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=UpdateChannel.GRACE_WINDOW_SECONDS + 0.1)
    assert alert is not None
    assert alert.flow == FLOW
    assert alert.expected_path == ["A", "B", "C"]
    assert alert.actual_path == ["A", "D", "C"]
    assert alert.responsible_router == "A"  # last common hop before divergence


def test_check_with_no_prior_legitimate_change_alerts_immediately():
    v = Verifier()
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=0.1)
    assert alert is not None


def test_check_boundary_just_inside_window_is_tolerated():
    """R7 boundary condition: window_end - epsilon must still be tolerated."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=UpdateChannel.GRACE_WINDOW_SECONDS - 0.001)
    assert alert is None


def test_check_boundary_just_outside_window_alerts():
    """R7 boundary condition: window_end + epsilon must already alert."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=UpdateChannel.GRACE_WINDOW_SECONDS + 0.001)
    assert alert is not None


def test_check_at_exact_window_boundary_alerts():
    """The window is a half-open interval [last_change, last_change + GRACE_WINDOW_SECONDS):
    now == last_change + GRACE_WINDOW_SECONDS exactly is already outside it (check() uses
    strict '<', not '<='), so the exact boundary instant alerts, not tolerates."""
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=UpdateChannel.GRACE_WINDOW_SECONDS)
    assert alert is not None


def test_push_legitimate_change_overwrites_not_setdefault():
    v = Verifier()
    v.push_legitimate_change(FLOW, now=0.0)
    v.push_legitimate_change(FLOW, now=5.0)  # must overwrite, not keep the first value
    # 0.9s after the SECOND change (still well past 5s from the first) must be tolerated
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.9)
    assert alert is None


def test_check_respects_custom_grace_window_seconds():
    v = Verifier(grace_window_seconds=5.0)
    v.push_legitimate_change(FLOW, now=0.0)
    assert v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=4.9) is None  # still tolerated
    alert = v.check(FLOW, ["A", "B", "C"], ["A", "D", "C"], now=5.1)
    assert alert is not None
