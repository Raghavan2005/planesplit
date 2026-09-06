"""Tests for backend/main.py's WS wiring: per-connection session isolation,
Origin validation, dead-socket cleanup (evict AND close), the
lifespan-managed background tick loop, malformed-JSON handling, and the
send_request -> request_event-then-snapshot sequence. Uses plain stub
objects satisfying just the subset of the WebSocket interface main.py
actually calls (headers/accept/receive_json/send_json/close) -- no real
network, no httpx/TestClient dependency.
"""
import asyncio

from fastapi import WebSocketDisconnect

import main as main_module

ALLOWED_ORIGIN = main_module.ALLOWED_ORIGINS[0]


class StubClient:
    """A connected socket with no incoming messages of its own -- used to
    observe what's sent to it without driving the receive loop."""

    def __init__(self, should_raise: bool = False, origin: str = ALLOWED_ORIGIN):
        self.should_raise = should_raise
        self.sent: list[dict] = []
        self.headers = {"origin": origin} if origin is not None else {}
        self.closed = False

    async def send_json(self, message: dict) -> None:
        if self.should_raise:
            raise RuntimeError("boom")
        self.sent.append(message)

    async def close(self, code: int = 1000) -> None:
        self.closed = True


class StubSocket(StubClient):
    """A connecting client: also drives the receive loop from a scripted
    sequence. An Exception instance in `incoming` is raised from
    receive_json() instead of returned, to simulate malformed JSON;
    exhausting the sequence raises WebSocketDisconnect, matching a real
    client closing the connection."""

    def __init__(self, incoming: list, origin: str = ALLOWED_ORIGIN):
        super().__init__(origin=origin)
        self._incoming = list(incoming)

    async def accept(self) -> None:
        pass

    async def receive_json(self):
        if not self._incoming:
            raise WebSocketDisconnect()
        item = self._incoming.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def test_disallowed_origin_is_rejected_before_accept():
    """SEC-002: a connection whose Origin header isn't in the allowlist
    must be closed with 1008 before ever reaching `accept()` or `sessions`."""
    socket = StubSocket([], origin="https://evil.example.com")

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.closed
    assert socket.sent == []
    assert socket not in main_module.sessions


def test_missing_origin_header_is_rejected_too():
    """A present-but-wrong Origin isn't the only case SEC-002 must catch --
    a connection with no Origin header at all (e.g. a non-browser client
    bypassing browser-enforced Origin) must be rejected too, not silently
    let through."""
    socket = StubSocket([], origin=None)

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.closed
    assert socket not in main_module.sessions


def test_allowed_origin_connects_and_gets_its_own_isolated_session():
    socket = StubSocket([])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.sent[0]["type"] == "state"  # initial snapshot on connect
    assert socket not in main_module.sessions  # cleaned up after WebSocketDisconnect


def test_two_connections_never_share_state_or_see_each_others_events():
    """The whole point of SEC-001: send_request on one connection must
    never be visible to a different connection, unlike the old
    global-state/broadcast-to-everyone behavior."""
    socket_a = StubSocket([{"action": "send_request", "server_id": "Server"}])
    socket_b = StubSocket([{"action": "update_route", "fault": "drop", "target_server_id": None}])

    asyncio.run(main_module.websocket_endpoint(socket_a))
    asyncio.run(main_module.websocket_endpoint(socket_b))

    # socket_a: initial snapshot, its own request_event, its own follow-up snapshot.
    assert [m["type"] for m in socket_a.sent] == ["state", "request_event", "state"]
    # socket_b: initial snapshot, its own post-fault snapshot -- never a
    # request_event, since it never ran send_request itself.
    assert [m["type"] for m in socket_b.sent] == ["state", "state"]


def test_send_failure_evicts_and_closes_the_session():
    """A send failure must both drop the session from `sessions` (so the
    tick loop stops ticking it) AND actually close the socket (so a
    session that fails to send isn't just abandoned mid-connection,
    leaking the underlying task)."""
    socket = StubClient(should_raise=True)
    main_module.sessions[socket] = main_module.SimulationState()

    asyncio.run(main_module.broadcast_snapshot(socket))

    assert socket not in main_module.sessions
    assert socket.closed


def test_broadcast_snapshot_is_a_noop_for_an_already_evicted_session():
    socket = StubClient()
    assert socket not in main_module.sessions

    asyncio.run(main_module.broadcast_snapshot(socket))

    assert socket.sent == []


def test_lifespan_creates_and_cancels_its_background_task():
    async def run():
        async with main_module.lifespan(main_module.app):
            tasks_during = {t for t in asyncio.all_tasks() if t is not asyncio.current_task()}
            assert len(tasks_during) == 1
            task = next(iter(tasks_during))
            assert not task.done()
            return task

        # unreachable, kept for clarity that we return from inside the `with`

    task = asyncio.run(run())
    assert task.cancelled()


def test_malformed_json_sends_error_and_keeps_connection_alive():
    socket = StubSocket([ValueError("bad json"), {"action": "reset"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.sent[0]["type"] == "state"  # initial snapshot on connect
    assert socket.sent[1] == {"type": "error", "message": "malformed JSON payload"}
    assert socket.sent[2]["type"] == "state"  # the following valid `reset` still processed
    assert socket not in main_module.sessions  # cleaned up after WebSocketDisconnect


def test_send_request_sends_request_event_then_snapshot_to_the_sender():
    socket = StubSocket([{"action": "send_request", "server_id": "Server"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert len(socket.sent) == 3
    assert socket.sent[0]["type"] == "state"          # initial snapshot on connect
    assert socket.sent[1]["type"] == "request_event"
    assert socket.sent[1]["status"] == "delivered"
    assert socket.sent[2]["type"] == "state"

    assert socket not in main_module.sessions


def test_assertion_error_from_dispatch_is_caught_and_reported(monkeypatch):
    """Regression test for dispatch.handle_action's documented-but-uncaught
    safety net: an AssertionError (e.g. a future action added to
    schemas.py without a matching dispatch branch) must be turned into a
    structured error to the sender, keep the connection alive, and still
    clean up `sessions` on eventual disconnect -- not escape uncaught and
    silently kill the connection's task."""

    def fake_handle_action(state, raw):
        raise AssertionError("no dispatch branch for validated action type FakeAction")

    monkeypatch.setattr(main_module, "handle_action", fake_handle_action)
    socket = StubSocket([{"action": "reset"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.sent[0]["type"] == "state"  # initial snapshot on connect
    assert socket.sent[1] == {
        "type": "error",
        "message": "no dispatch branch for validated action type FakeAction",
    }
    assert socket not in main_module.sessions  # cleaned up after WebSocketDisconnect


def test_unknown_action_sends_error_only_to_the_sender():
    socket = StubSocket([{"action": "bogus"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.sent[1] == {"type": "error", "message": "unknown or missing action: 'bogus'"}
