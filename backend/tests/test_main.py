"""Tests for backend/main.py's WS wiring: dead-socket cleanup, the
lifespan-managed background tick loop, malformed-JSON handling, and the
send_request -> request_event-then-snapshot broadcast sequence. Uses plain
stub objects satisfying just the subset of the WebSocket interface main.py
actually calls (accept/receive_json/send_json) -- no real network, no
httpx/TestClient dependency.
"""
import asyncio

from fastapi import WebSocketDisconnect

import main as main_module


class StubClient:
    """A broadcast target with no incoming messages of its own -- used to
    observe what a broadcast sends, without driving the receive loop."""

    def __init__(self, should_raise: bool = False):
        self.should_raise = should_raise
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        if self.should_raise:
            raise RuntimeError("boom")
        self.sent.append(message)


class StubSocket(StubClient):
    """A connecting client: also drives the receive loop from a scripted
    sequence. An Exception instance in `incoming` is raised from
    receive_json() instead of returned, to simulate malformed JSON;
    exhausting the sequence raises WebSocketDisconnect, matching a real
    client closing the connection."""

    def __init__(self, incoming: list):
        super().__init__()
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


def test_broadcast_snapshot_drops_only_the_raising_client():
    main_module.state.reset()
    good = StubClient()
    bad = StubClient(should_raise=True)
    main_module.clients.clear()
    main_module.clients.extend([good, bad])

    asyncio.run(main_module.broadcast_snapshot())

    assert good in main_module.clients
    assert bad not in main_module.clients
    assert len(good.sent) == 1
    assert good.sent[0]["type"] == "state"


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
    main_module.state.reset()
    main_module.clients.clear()
    socket = StubSocket([ValueError("bad json"), {"action": "reset"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert socket.sent[0]["type"] == "state"  # initial snapshot on connect
    assert socket.sent[1] == {"type": "error", "message": "malformed JSON payload"}
    assert socket.sent[2]["type"] == "state"  # the following valid `reset` still processed
    assert socket not in main_module.clients  # cleaned up after WebSocketDisconnect


def test_send_request_broadcasts_request_event_then_snapshot_to_every_client():
    main_module.state.reset()
    main_module.clients.clear()
    observer = StubClient()
    main_module.clients.append(observer)
    socket = StubSocket([{"action": "send_request", "server_id": "Server"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    # observer never receives the initial per-connection snapshot (that's
    # sent only to the connecting socket), but sees both broadcasts the
    # send_request action triggers.
    assert len(observer.sent) == 2
    assert observer.sent[0]["type"] == "request_event"
    assert observer.sent[0]["status"] == "delivered"
    assert observer.sent[1]["type"] == "state"

    assert len(socket.sent) == 3
    assert socket.sent[0]["type"] == "state"          # initial snapshot on connect
    assert socket.sent[1]["type"] == "request_event"
    assert socket.sent[2]["type"] == "state"

    assert socket not in main_module.clients
    assert observer in main_module.clients


def test_unknown_action_sends_error_only_to_the_sender_not_a_broadcast():
    main_module.state.reset()
    main_module.clients.clear()
    observer = StubClient()
    main_module.clients.append(observer)
    socket = StubSocket([{"action": "bogus"}])

    asyncio.run(main_module.websocket_endpoint(socket))

    assert observer.sent == []  # never broadcast to -- only the sender sees the error
    assert socket.sent[1] == {"type": "error", "message": "unknown or missing action: 'bogus'"}
