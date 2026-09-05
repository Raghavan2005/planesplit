import pytest
from pydantic import ValidationError

from schemas import (
    ACTION_MODELS,
    RemediateAction,
    ResetAction,
    ScaleAction,
    SendRequestAction,
    UpdateRouteAction,
)


def test_reset_action_accepts_valid_payload():
    model = ResetAction.model_validate({"action": "reset"})
    assert model.action == "reset"


def test_update_route_action_accepts_valid_payload_with_defaults():
    model = UpdateRouteAction.model_validate({"action": "update_route"})
    assert model.fault == "none"
    assert model.target_server_id is None


def test_update_route_action_accepts_explicit_fault_and_target():
    model = UpdateRouteAction.model_validate(
        {"action": "update_route", "fault": "drop", "target_server_id": "Server_2"}
    )
    assert model.fault == "drop"
    assert model.target_server_id == "Server_2"


def test_update_route_action_rejects_unknown_fault():
    with pytest.raises(ValidationError):
        UpdateRouteAction.model_validate({"action": "update_route", "fault": "bogus"})


def test_scale_action_accepts_valid_payload():
    model = ScaleAction.model_validate({"action": "scale", "num_servers": 3, "num_users": 5})
    assert model.num_servers == 3
    assert model.num_users == 5
    assert model.grace_window_seconds is None


def test_scale_action_rejects_wrong_typed_field():
    with pytest.raises(ValidationError):
        ScaleAction.model_validate({"action": "scale", "num_servers": "four", "num_users": 1})


def test_remediate_action_accepts_valid_payload():
    model = RemediateAction.model_validate({"action": "remediate", "server_id": "Server"})
    assert model.server_id == "Server"


def test_remediate_action_rejects_missing_server_id():
    with pytest.raises(ValidationError):
        RemediateAction.model_validate({"action": "remediate"})


def test_send_request_action_accepts_valid_payload():
    model = SendRequestAction.model_validate({"action": "send_request", "server_id": "Server"})
    assert model.server_id == "Server"


def test_send_request_action_rejects_missing_server_id():
    with pytest.raises(ValidationError):
        SendRequestAction.model_validate({"action": "send_request"})


def test_action_models_covers_all_five_actions():
    assert set(ACTION_MODELS.keys()) == {
        "reset", "update_route", "scale", "remediate", "send_request",
    }
