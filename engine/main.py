import asyncio
import random
import time
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vexoris Telemetry Engine")

# Allow Next.js frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/status")
def get_status():
    return {
        "engine": "Vexoris Telemetry Ingestion Engine",
        "status": "ONLINE",
        "version": "1.0.4-DEV",
        "supported_formats": ["MCAP", "ROS2", "CAN_BUS"]
    }

@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):
    await websocket.accept()
    timestamp = 14.000
    
    try:
        while True:
            # Simulate high-frequency 100Hz telemetry frame
            is_anomaly = timestamp >= 14.020
            
            payload = {
                "timestamp": round(timestamp, 3),
                "node_id": "MCAP_ROS2_EDGE_8802",
                "lidar_points": 4000,
                "model_weight": 0.08 if is_anomaly else 0.98,
                "glare_index": 0.94 if is_anomaly else round(random.uniform(0.02, 0.06), 2),
                "status": "CRITICAL_ANOMALY" if is_anomaly else "NOMINAL",
                "anomaly_detail": "Optical Sensor Saturation at Camera Node #2" if is_anomaly else None
            }
            
            await websocket.send_json(payload)
            
            # Step time by 5ms intervals (200 FPS output rate)
            timestamp += 0.005
            if timestamp > 14.100:
                timestamp = 14.000
                
            await asyncio.sleep(0.05)  # Stream frequency throttle
    except Exception as e:
        print(f"WebSocket Client Disconnected: {e}")