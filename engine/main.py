import asyncio
import io
import json
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


app = FastAPI(title="Vexoris Engine Core", version="1.0.4")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TelemetryPayload(BaseModel):
    timestamp: float
    node_id: str
    lidar_points: int
    model_weight: float
    glare_index: float
    can_bus_brake_pressure_psi: Optional[float] = 0.0
    status: str
    anomaly_detail: Optional[str] = None


@app.get("/")
def health_check():
    return {
        "status": "VEXORIS_ENGINE_ONLINE",
        "system": "Deterministic Forensics",
    }


@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """Simulate deterministic MCAP/ROS2 telemetry playback at 100 Hz."""
    await websocket.accept()

    start_time = 14.000
    frame = 0

    try:
        while True:
            timestamp = start_time + (frame * 0.01)

            if 14.450 <= timestamp <= 17.950:
                progress = (timestamp - 14.450) / 3.500
                glare = min(0.92, 0.05 + (progress * 1.8))
                model_weight = max(0.14, 0.98 - (progress * 1.7))
                lidar_points = max(
                    1100,
                    int(4000 - (progress * 3500)),
                )
                brake_psi = min(1180.0, progress * 2400.0)
                status = "CRITICAL_ANOMALY"
                detail = (
                    "Optical Glare Saturation detected on Front-Left Camera "
                    "[Camera_FL]. Perception Confidence below critical threshold "
                    "(14%). Emergency CAN Bus Brake Pressure Triggered."
                )
            else:
                glare = 0.05
                model_weight = 0.98
                lidar_points = 4000
                brake_psi = 0.0
                status = "NOMINAL"
                detail = None

            packet = {
                "timestamp": round(timestamp, 3),
                "node_id": "MCAP_ROS2_EDGE_8802",
                "lidar_points": lidar_points,
                "model_weight": round(model_weight, 2),
                "glare_index": round(glare, 2),
                "can_bus_brake_pressure_psi": round(brake_psi, 1),
                "status": status,
                "anomaly_detail": detail,
            }

            await websocket.send_text(json.dumps(packet))
            frame += 1

            if frame > 800:
                frame = 0

            await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        print("[VEXORIS] Client disconnected from telemetry stream.")


@app.post("/api/v1/export-audit")
async def export_audit_pdf(payload: TelemetryPayload):
    """Generate a deterministic incident audit PDF for compliance review."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        textColor=colors.HexColor("#00f0ff"),
        spaceAfter=12,
    )
    body_style = ParagraphStyle(
        "DocBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        textColor=colors.HexColor("#222222"),
        spaceAfter=8,
    )

    elements = [
        Paragraph(
            "VEXORIS SPATIAL FORENSICS // INCIDENT AUDIT REPORT",
            title_style,
        ),
        Paragraph(
            "<b>Engine Version:</b> v1.0.4-DEV | "
            "<b>Verification Status:</b> DETERMINISTIC_LEGAL_SEAL",
            body_style,
        ),
        Spacer(1, 12),
    ]

    data = [
        ["Parameter", "Captured Value", "Validation Threshold"],
        ["Timestamp", f"t = {payload.timestamp:.3f} s", "N/A"],
        ["Edge Node ID", payload.node_id, "Registered ROS2 Edge"],
        ["System Status", payload.status, "NOMINAL / ANOMALY"],
        ["LiDAR Point Cloud Density", f"{payload.lidar_points} pts", "> 2500 pts"],
        [
            "Neural Model Weight Confidence",
            f"{payload.model_weight * 100:.0f}%",
            "> 75%",
        ],
        ["Optical Glare Saturation Index", f"{payload.glare_index:.2f}", "< 0.30"],
        [
            "CAN Bus Brake Pressure",
            f"{payload.can_bus_brake_pressure_psi or 0.0:.1f} PSI",
            "0.0 PSI (Nominal)",
        ],
    ]

    table = Table(data, colWidths=[200, 180, 160])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0c1017")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#00f0ff")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8f9fa")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ]
        )
    )
    elements.extend([table, Spacer(1, 16)])

    elements.append(
        Paragraph("<b>HARDWARE FAULT ISOLATION ANALYSIS:</b>", styles["Heading2"])
    )
    if payload.anomaly_detail:
        elements.append(
            Paragraph(
                "<font color='#ff0055'><b>CRITICAL EXCEPTION DETECTED:</b> "
                f"{payload.anomaly_detail}</font>",
                body_style,
            )
        )
    else:
        elements.append(
            Paragraph(
                "No telemetry deviations or hardware perception failures observed "
                "during the selected timestamp window.",
                body_style,
            )
        )

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=Vexoris_Audit_{payload.node_id}.pdf"
            )
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("engine.main:app", host="0.0.0.0", port=8000, reload=True)
