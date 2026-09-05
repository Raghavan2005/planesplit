import asyncio
import sys
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager
from pathlib import Path

# Make the repo root importable regardless of the current working directory,
# so `from planesplit...` resolves whether this is run as `python main.py`
# from backend/ or as `python -m backend.main` from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dispatch import handle_action
from state import SimulationState

state = SimulationState()
clients: list[WebSocket] = []


async def broadcast_snapshot() -> None:
    message = state.snapshot().to_dict()
    await _broadcast(message)


async def _broadcast(message: dict) -> None:
    # Collect and drop dead sockets within this same call, rather than
    # relying on the next WebSocketDisconnect from that socket's own receive
    # loop to notice -- a socket that fails to send here would otherwise
    # linger in `clients` until it happens to be its own turn to disconnect.
    dead: list[WebSocket] = []
    for client in list(clients):
        try:
            await client.send_json(message)
        except Exception:
            dead.append(client)
    for client in dead:
        if client in clients:
            clients.remove(client)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def loop():
        while True:
            await asyncio.sleep(0.3)
            if clients:
                state.tick()
                await broadcast_snapshot()

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # allow_credentials=True combined with allow_origins=["*"] is rejected by
    # browsers in strict mode and is a real misconfiguration — this app uses
    # no cookies/auth, so allow_credentials=False is the correct fix, not a
    # workaround.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    await websocket.send_json(state.snapshot().to_dict())
    try:
        while True:
            try:
                raw = await websocket.receive_json()
            except (ValueError, TypeError):
                # Malformed JSON text -- reject this one message, keep the
                # connection alive, same as a validation failure below.
                await websocket.send_json({"type": "error", "message": "malformed JSON payload"})
                continue

            result = handle_action(state, raw)
            if result is None:
                await broadcast_snapshot()
            elif result.get("type") == "error":
                await websocket.send_json(result)
            else:
                # A distinct success payload (currently only send_request's
                # request_event) -- every connected viewer should see the
                # request travel, matching the shared-world-state model the
                # rest of this app already uses, then a normal snapshot
                # broadcast keeps status/recent_requests consistent.
                await _broadcast(result)
                await broadcast_snapshot()
    except WebSocketDisconnect:
        if websocket in clients:
            clients.remove(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
