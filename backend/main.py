from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import ipaddress
from network import Network, Router, Packet

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationState:
    def __init__(self):
        self.net = Network()
        self.setup_baseline()
        
    def setup_baseline(self):
        self.net = Network()
        for name in ["Users", "Firewall", "Server", "AWS_ALB"]:
            self.net.add_router(Router(name))
            
        rA = self.net.routers["Users"]
        rB = self.net.routers["Firewall"]
        rC = self.net.routers["Server"]
        rD = self.net.routers["AWS_ALB"]

        # Default paths
        rA.add_rib_rule("10.0.1.0/24", "Firewall")
        rA.add_fib_rule("10.0.1.0/24", "Firewall")
        rB.add_rib_rule("10.0.1.0/24", "Server")
        rB.add_fib_rule("10.0.1.0/24", "Server")
        
        rD.add_rib_rule("10.0.1.0/24", "Server")
        rD.add_fib_rule("10.0.1.0/24", "Server")
        
    def verify_prefix(self, prefix: str):
        # Boundary probing logic: try the first and last IP of the subnet
        net = ipaddress.ip_network(prefix, strict=False)
        try:
            test_ip_1 = str(next(net.hosts()))
            test_ip_2 = str(list(net.hosts())[-1])
        except:
            test_ip_1 = str(net.network_address)
            test_ip_2 = str(net.network_address)
            
        packet1_cp = Packet("0.0.0.0", test_ip_1)
        packet1_dp = Packet("0.0.0.0", test_ip_1)
        
        cp_trace = self.net.simulate_path(packet1_cp, "Users", use_cp=True)
        dp_trace = self.net.simulate_path(packet1_dp, "Users", use_cp=False)
        
        return cp_trace, dp_trace

state = SimulationState()

clients = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            cmd = json.loads(data)
            
            if cmd["action"] == "reset":
                state.setup_baseline()
                cp, dp = state.verify_prefix("10.0.1.0/24")
                await broadcast({"type": "state", "cp_trace": cp, "dp_trace": dp})
                
            elif cmd["action"] == "update_route":
                # Intent: Users -> AWS_ALB -> Server
                state.net.routers["Users"].add_rib_rule("10.0.1.0/24", "AWS_ALB")
                
                fault_type = cmd.get("fault", "none")
                
                cp, dp = state.verify_prefix("10.0.1.0/24")
                await broadcast({"type": "state", "cp_trace": cp, "dp_trace": dp})
                
                if fault_type == "delay":
                    await asyncio.sleep(2) # simulate delay
                    state.net.routers["Users"].add_fib_rule("10.0.1.0/24", "AWS_ALB")
                    cp, dp = state.verify_prefix("10.0.1.0/24")
                    await broadcast({"type": "state", "cp_trace": cp, "dp_trace": dp, "note": "Convergence achieved"})
                    
                elif fault_type == "drop":
                    # We just never update the FIB!
                    pass
                    
                elif fault_type == "corrupt":
                    # Put a /25 instead of /24 in the FIB
                    state.net.routers["Users"].add_fib_rule("10.0.1.0/25", "AWS_ALB")
                    cp, dp = state.verify_prefix("10.0.1.0/24")
                    await broadcast({"type": "state", "cp_trace": cp, "dp_trace": dp, "note": "Corrupted FIB rule applied"})

    except WebSocketDisconnect:
        clients.remove(websocket)

async def broadcast(message: dict):
    for client in clients:
        try:
            await client.send_json(message)
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
