import asyncio
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

# [SEC-001] Session Isolation: Replace global state with a per-connection dictionary.
sessions: dict[WebSocket, SimulationState] = {}


async def broadcast_snapshot(websocket: WebSocket) -> None:
    """Send the isolated state snapshot only to its owning client."""
    if websocket not in sessions:
        return
    state = sessions[websocket]
    message = state.snapshot().to_dict()
    try:
        await websocket.send_json(message)
    except Exception:
        sessions.pop(websocket, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def loop():
        while True:
            await asyncio.sleep(0.3)
            if sessions:
                # Tick all isolated states
                for state in sessions.values():
                    state.tick()
                
                # Broadcast concurrently to prevent slow clients from blocking the loop
                tasks = [broadcast_snapshot(ws) for ws in list(sessions.keys())]
                await asyncio.gather(*tasks, return_exceptions=True)

    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(lifespan=lifespan)

# [SEC-003] Strict CORS Configuration
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # [SEC-002] Cross-Site WebSocket Hijacking (CSWSH) Origin Validation
    origin = websocket.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    
    # Initialize a clean, isolated state for this specific user
    state = SimulationState()
    sessions[websocket] = state
    
    try:
        await websocket.send_json(state.snapshot().to_dict())
    except Exception:
        sessions.pop(websocket, None)
        return

    try:
        while True:
            try:
                raw = await websocket.receive_json()
            except (ValueError, TypeError):
                await websocket.send_json({"type": "error", "message": "malformed JSON payload"})
                continue

            try:
                result = handle_action(state, raw)
            except AssertionError as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
                continue

            if result is None:
                await broadcast_snapshot(websocket)
            elif result.get("type") == "error":
                await websocket.send_json(result)
            else:
                # Success payload (RequestEvent). Since state is isolated, 
                # we only send this to the specific user who requested it.
                await websocket.send_json(result)
                await broadcast_snapshot(websocket)
                
    except WebSocketDisconnect:
        sessions.pop(websocket, None)
    except Exception:
        # Catch unexpected errors to prevent loop crashes, evicting the broken session
        sessions.pop(websocket, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
