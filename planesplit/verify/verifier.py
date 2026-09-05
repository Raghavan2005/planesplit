from dataclasses import dataclass
from ipaddress import IPv4Network
from typing import Optional

from planesplit.faults.update_channel import UpdateChannel


@dataclass
class Alert:
    flow: IPv4Network
    responsible_router: str
    expected_path: list[str]
    actual_path: list[str]
    detected_at: float
    reason: str


class Verifier:
    """Per-flow grace-window state machine.

    Grace-window state is tracked per flow/destination, never globally — an
    old, already-expired divergence on one flow must never mask, or be
    masked by, a fresh, still-tolerated change on another (TEST_PLAN.md
    Scenario 5), and a rapid sequence of legitimate changes to the same flow
    must keep resetting that flow's own window on every call (Scenario 6).
    """

    def __init__(self):
        self._last_legitimate_change_at: dict[IPv4Network, float] = {}

    def push_legitimate_change(self, flow: IPv4Network, now: float) -> None:
        # Always overwrite — never setdefault-once. A flow that changes 5
        # times in 2 seconds must have its window measured from the 5th
        # change, not the 1st, or Scenario 6 (route flapping) breaks silently.
        self._last_legitimate_change_at[flow] = now

    def check(
        self,
        flow: IPv4Network,
        intended: list[str],
        actual: list[str],
        now: float,
    ) -> Optional[Alert]:
        if intended == actual:
            return None  # converged — no divergence to evaluate at all

        last_change = self._last_legitimate_change_at.get(flow)
        if last_change is not None and (now - last_change) < UpdateChannel.GRACE_WINDOW_SECONDS:
            return None  # divergence expected and tolerated inside this flow's own window

        return Alert(
            flow=flow,
            responsible_router=self._divergence_point(intended, actual),
            expected_path=list(intended),
            actual_path=list(actual),
            detected_at=now,
            reason=(
                f"actual path {actual} no longer matches intended path {intended} "
                f"for flow {flow}, and the grace window "
                f"({UpdateChannel.GRACE_WINDOW_SECONDS}s since last legitimate change "
                f"at {last_change}) has elapsed"
            ),
        )

    @staticmethod
    def _divergence_point(intended: list[str], actual: list[str]) -> str:
        for i, (a, b) in enumerate(zip(intended, actual)):
            if a != b:
                return intended[i - 1] if i > 0 else intended[0]
        shorter = intended if len(intended) < len(actual) else actual
        return shorter[-1] if shorter else "unknown"
