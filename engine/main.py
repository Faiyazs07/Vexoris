import asyncio
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from engine.mcap_parser import McapLogEngine


app = FastAPI(title="Vexoris Telemetry Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mcap_engine = McapLogEngine("sample_run_8802.mcap")


@app.get("/status")
def get_status():
    return {
        "engine": "Vexoris Telemetry Ingestion Engine",
        "status": "ONLINE",
        "version": "1.0.4-DEV",
        "mcap_metadata": mcap_engine.parse_header()
    }


@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            # Replay stream from MCAP log engine generator
            for frame in mcap_engine.generate_log_stream(14.000, 14.050):
                await websocket.send_json(frame)
                await asyncio.sleep(0.3)  # Readable pacing step
    except Exception as e:
        print(f"WebSocket Client Disconnected: {e}")
