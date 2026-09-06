import asyncio
import logging
import os
import sys
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dispatch import handle_action
from state import SimulationState

logger = logging.getLogger("planesplit.backend")

# [SEC-001] Session isolation: one SimulationState per WebSocket connection,
# never shared between viewers -- replaces the old global `state`/`clients`.
sessions: dict[WebSocket, SimulationState] = {}


async def _send(websocket: WebSocket, message: dict) -> bool:
    """Send `message` to `websocket`. On any failure, evict it from
    `sessions` AND actually close the socket -- a session that's dropped
    from bookkeeping but never closed would otherwise leak its connection
    for the life of the process. Returns whether the send succeeded, so
    callers never keep acting on a connection that's already gone. Logged
    (not swallowed) so a real backend bug is distinguishable from a normal
    client disconnect during a live demo."""
    try:
        await websocket.send_json(message)
        return True
    except Exception:
        logger.warning("send failed for %r, evicting session", getattr(websocket, "client", websocket), exc_info=True)
        sessions.pop(websocket, None)
        try:
            await websocket.close()
        except Exception:
            pass
        return False


async def broadcast_snapshot(websocket: WebSocket) -> None:
    """Recompute and send this connection's own current snapshot -- used
    after an action mutates state outside the periodic tick loop below."""
    state = sessions.get(websocket)
    if state is None:
        return
    await _send(websocket, state.snapshot().to_dict())


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def loop():
        while True:
            await asyncio.sleep(0.3)
            if not sessions:
                continue
            # tick() already applies due delayed updates AND recomputes+
            # returns that session's full Snapshot -- send it directly
            # instead of letting broadcast_snapshot() recompute the same
            # snapshot a second time right after. Ticked into a plain dict
            # (not iterated live against `sessions`) so an eviction inside
            # the gather below can't raise "dictionary changed size during
            # iteration".
            snapshots = {ws: state.tick() for ws, state in sessions.items()}
            await asyncio.gather(
                *(_send(ws, snap.to_dict()) for ws, snap in snapshots.items()),
                return_exceptions=True,
            )

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(lifespan=lifespan)

# [SEC-003] Strict CORS configuration. Overridable via CORS_ALLOWED_ORIGINS
# (comma-separated) so running the demo from a LAN IP, a non-default Vite
# port, or a preview build doesn't silently break CORS/the WS handshake
# with no indication why -- same pattern as frontend's VITE_WS_URL.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # [SEC-002] Cross-Site WebSocket Hijacking (CSWSH) Origin validation.
    # Rejects a missing Origin header too, not just a present-but-wrong
    # one -- a real browser-initiated WS handshake always sends Origin, so
    # requiring it (rather than only checking it when present) is what
    # actually closes off a non-browser client bypassing this check.
    origin = websocket.headers.get("origin")
    if origin not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    # A clean, isolated state for this specific connection -- never shared
    # with any other connected viewer.
    state = SimulationState()
    sessions[websocket] = state

    if not await _send(websocket, state.snapshot().to_dict()):
        return

    try:
        while True:
            try:
                raw = await websocket.receive_json()
            except (ValueError, TypeError):
                if not await _send(websocket, {"type": "error", "message": "malformed JSON payload"}):
                    return
                continue

            # The send above may have failed and evicted this session (a
            # transient send failure, not a WebSocketDisconnect) -- keep
            # mutating/broadcasting against `state` on a socket that's
            # already been evicted, and every following action would
            # silently no-op forever with the UI frozen and no error.
            if websocket not in sessions:
                return

            try:
                result = handle_action(state, raw)
            except AssertionError as exc:
                if not await _send(websocket, {"type": "error", "message": str(exc)}):
                    return
                continue

            if result is None:
                await broadcast_snapshot(websocket)
            elif result.get("type") == "error":
                if not await _send(websocket, result):
                    return
            else:
                # Success payload (RequestEvent). Since state is isolated,
                # this only ever goes to the specific user who requested
                # it -- never fanned out to other connections.
                if not await _send(websocket, result):
                    return
                await broadcast_snapshot(websocket)

            if websocket not in sessions:
                return
    except WebSocketDisconnect:
        sessions.pop(websocket, None)
    except Exception:
        logger.exception("unexpected error in websocket_endpoint, evicting session")
        sessions.pop(websocket, None)
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
