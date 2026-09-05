import asyncio
import sys
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from pathlib import Path

# Make the repo root importable regardless of the current working directory,
# so `from planesplit...` resolves whether this is run as `python main.py`
# from backend/ or as `python -m backend.main` from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from state import SimulationState

app = FastAPI()
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

state = SimulationState()
clients: list[WebSocket] = []


async def broadcast_snapshot() -> None:
    message = state.snapshot().to_dict()
    for client in list(clients):
        try:
            await client.send_json(message)
        except Exception:
            pass


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    await websocket.send_json(state.snapshot().to_dict())
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "reset":
                state.reset()
            elif action == "update_route":
                state.inject(data.get("fault", "none"))
            elif action == "scale":
                state.scale(data.get("num_servers", 1), data.get("num_users", 1))
            await broadcast_snapshot()
    except WebSocketDisconnect:
        clients.remove(websocket)


@app.on_event("startup")
async def start_tick_loop() -> None:
    async def loop():
        while True:
            await asyncio.sleep(0.3)
            if clients:
                state.tick()
                await broadcast_snapshot()

    asyncio.create_task(loop())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
