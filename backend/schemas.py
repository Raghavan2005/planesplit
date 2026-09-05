"""Pydantic request models for the WebSocket action protocol.

Each model corresponds to one `action` value in an incoming WS message.
Validating against these before touching `SimulationState` means a
wrong-typed or missing field is rejected with a structured error instead of
raising uncaught deep inside state.py and killing that client's WS loop
(CLAUDE.md SS11: never trust client-side validation, validate at the
boundary).

Dispatch is a plain dict lookup on the `action` string (ACTION_MODELS)
rather than a Pydantic discriminated union — simpler for 4-5 flat,
mutually-exclusive variants, and it keeps "unknown action" a dict-miss
rather than a less legible union-validation error.
"""
from typing import Literal, Optional

from pydantic import BaseModel


class ResetAction(BaseModel):
    action: Literal["reset"]


class UpdateRouteAction(BaseModel):
    action: Literal["update_route"]
    fault: Literal["none", "delay", "drop", "corrupt"] = "none"
    target_server_id: Optional[str] = None


class ScaleAction(BaseModel):
    action: Literal["scale"]
    num_servers: int
    num_users: int
    grace_window_seconds: Optional[float] = None
    min_packet_size: Optional[int] = None
    max_packet_size: Optional[int] = None


class RemediateAction(BaseModel):
    action: Literal["remediate"]
    server_id: str


class SendRequestAction(BaseModel):
    action: Literal["send_request"]
    server_id: str


ACTION_MODELS: dict[str, type[BaseModel]] = {
    "reset": ResetAction,
    "update_route": UpdateRouteAction,
    "scale": ScaleAction,
    "remediate": RemediateAction,
    "send_request": SendRequestAction,
}
