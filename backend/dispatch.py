"""Pure, framework-independent WS action dispatcher.

Deliberately has no FastAPI/WebSocket import (same rationale as state.py's
own docstring: directly unit-testable without a live server, per CLAUDE.md
Section16). Validates a raw incoming payload against schemas.py, applies it
to a SimulationState, and reports the outcome as one of three shapes so the
caller (backend/main.py) never has to guess what to broadcast:

- None            -> success, caller should broadcast a fresh snapshot.
- {"type": "error", "message": ...} -> reject; caller sends this to just
  the originating client, must NOT broadcast, must NOT crash the loop.
- {"type": "request_event", ...}    -> success, but the interesting result
  IS this payload (a single discrete RequestEvent), not a generic state
  snapshot -- returned only for the send_request action.
"""
from typing import Optional, Union

from pydantic import ValidationError

from schemas import (
    ACTION_MODELS,
    RemediateAction,
    ResetAction,
    ScaleAction,
    SendRequestAction,
    UpdateRouteAction,
)
from state import SimulationState

DispatchResult = Optional[dict]


def handle_action(state: SimulationState, raw: object) -> DispatchResult:
    if not isinstance(raw, dict):
        return {"type": "error", "message": "payload must be a JSON object"}

    action_name = raw.get("action")
    model_cls = ACTION_MODELS.get(action_name)
    if model_cls is None:
        return {"type": "error", "message": f"unknown or missing action: {action_name!r}"}

    try:
        parsed: Union[ResetAction, UpdateRouteAction, ScaleAction, RemediateAction, SendRequestAction] = (
            model_cls.model_validate(raw)
        )
    except ValidationError as exc:
        return {"type": "error", "message": str(exc)}

    try:
        if isinstance(parsed, ResetAction):
            state.reset()
            return None
        if isinstance(parsed, UpdateRouteAction):
            state.inject(parsed.fault, target_server_id=parsed.target_server_id)
            return None
        if isinstance(parsed, ScaleAction):
            state.scale(
                parsed.num_servers, parsed.num_users,
                grace_window_seconds=parsed.grace_window_seconds,
                min_packet_size=parsed.min_packet_size,
                max_packet_size=parsed.max_packet_size,
            )
            return None
        if isinstance(parsed, RemediateAction):
            state.remediate(parsed.server_id)
            return None
        if isinstance(parsed, SendRequestAction):
            event = state.send_request(parsed.server_id)
            return event.to_dict()
    except ValueError as exc:
        return {"type": "error", "message": str(exc)}

    # Unreachable given ACTION_MODELS only maps to the 5 branches above, but
    # fails loudly rather than silently no-op'ing if a new action is ever
    # added to schemas.py without a matching branch here.
    raise AssertionError(f"no dispatch branch for validated action type {type(parsed).__name__}")
