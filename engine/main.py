import asyncio
from fastapi import Body, FastAPI, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict
from engine.mcap_parser import McapLogEngine
from engine.report_generator import generate_forensic_pdf


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


@app.post("/api/v1/export-audit")
async def export_audit_pdf(telemetry_data: Dict[str, Any] = Body(...)):
    """Generate a downloadable PDF audit report from active frame telemetry."""
    pdf_bytes = generate_forensic_pdf(telemetry_data)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                "attachment; filename="
                f"Vexoris_Incident_Audit_{telemetry_data.get('node_id', '8802')}.pdf"
            )
        },
    )


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
