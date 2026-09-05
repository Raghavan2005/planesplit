from dispatch import handle_action
from state import GRACE_WINDOW_SECONDS, SimulationState


class FakeClock:
    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def test_reset_action_mutates_state_and_returns_none():
    sim = SimulationState(clock=FakeClock())
    sim.scale(3, 3)
    result = handle_action(sim, {"action": "reset"})
    assert result is None
    assert len(sim.flows) == 1


def test_update_route_action_mutates_state_and_returns_none():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    result = handle_action(sim, {"action": "update_route", "fault": "drop"})
    assert result is None
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    assert sim.tick().status == "alert"


def test_scale_action_mutates_state_and_returns_none():
    sim = SimulationState(clock=FakeClock())
    result = handle_action(sim, {"action": "scale", "num_servers": 4, "num_users": 2})
    assert result is None
    assert len(sim.flows) == 4


def test_remediate_action_mutates_state_and_returns_none():
    clock = FakeClock()
    sim = SimulationState(clock=clock)
    sim.reset()
    sim.inject("drop")
    clock.advance(GRACE_WINDOW_SECONDS + 0.1)
    sim.tick()

    result = handle_action(sim, {"action": "remediate", "server_id": "Server"})
    assert result is None
    assert sim.snapshot().status == "synced"


def test_send_request_action_returns_the_request_event_payload():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    result = handle_action(sim, {"action": "send_request", "server_id": "Server"})
    assert result is not None
    assert result["type"] == "request_event"
    assert result["status"] == "delivered"
    assert result["server_id"] == "Server"


def test_unknown_action_returns_error_and_does_not_mutate_state():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    before = sim.snapshot().to_dict()
    result = handle_action(sim, {"action": "bogus"})
    assert result == {"type": "error", "message": "unknown or missing action: 'bogus'"}
    assert sim.snapshot().to_dict() == before


def test_missing_action_key_returns_error():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    result = handle_action(sim, {})
    assert result is not None
    assert result["type"] == "error"


def test_non_dict_payload_returns_error_and_does_not_mutate_state():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    before = sim.snapshot().to_dict()
    result = handle_action(sim, "just a string")
    assert result == {"type": "error", "message": "payload must be a JSON object"}
    assert sim.snapshot().to_dict() == before


def test_wrong_typed_field_returns_error_and_does_not_mutate_state():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    before = sim.snapshot().to_dict()
    result = handle_action(sim, {"action": "scale", "num_servers": "four", "num_users": 1})
    assert result is not None
    assert result["type"] == "error"
    assert sim.snapshot().to_dict() == before


def test_remediate_on_a_synced_server_returns_error_not_exception():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    result = handle_action(sim, {"action": "remediate", "server_id": "Server"})
    assert result is not None
    assert result["type"] == "error"
    assert "no active alert" in result["message"]


def test_send_request_for_unknown_server_id_returns_error_not_exception():
    sim = SimulationState(clock=FakeClock())
    sim.reset()
    result = handle_action(sim, {"action": "send_request", "server_id": "NoSuchServer"})
    assert result is not None
    assert result["type"] == "error"
    assert "unknown server_id" in result["message"]
