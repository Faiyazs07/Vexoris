import asyncio
import base64
import io
import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from PIL import Image, ImageDraw
from engine.mcap_parser import DecodedMessage, ROSLogSession
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


app = FastAPI(title="Vexoris Engine Core", version="1.0.4")

UPLOAD_DIRECTORY = Path(__file__).resolve().parent.parent / "log_cache" / "uploads"
ALLOWED_LOG_EXTENSIONS = {".mcap", ".db3"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
active_log_path: Path | None = None
active_log_session: ROSLogSession | None = None
active_log_revision = 0

PLAYBACK_START_TIME = 14.0
PLAYBACK_END_TIME = 22.0
PLAYBACK_STEP_SECONDS = 0.01
ALLOWED_PLAYBACK_SPEEDS = {0.5, 1.0, 2.0}
AVAILABLE_CHANNELS = frozenset(
    {
        "/lidar/points",
        "/model/fusion_weight",
        "/sensors/camera_fl/glare",
        "/camera/front_left/image_raw",
        "/can/chassis/brake_pressure",
        "/diagnostics/status",
    }
)

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
    lidar_points: Optional[int] = None
    model_weight: Optional[float] = None
    glare_index: Optional[float] = None
    can_bus_brake_pressure_psi: Optional[float] = 0.0
    status: str
    anomaly_detail: Optional[str] = None


class PlaybackState:
    """Mutable playback controls scoped to a single WebSocket connection."""

    def __init__(self) -> None:
        self.is_playing = True
        self.speed = 1.0
        self.current_time = (
            0.0
            if active_log_session
            else PLAYBACK_START_TIME
        )
        self.seek_revision = 0
        self.enabled_channels = (
            {topic.name for topic in active_log_session.metadata.topics}
            if active_log_session
            else set(AVAILABLE_CHANNELS)
        )

    def seek(self, timestamp: float) -> None:
        self.current_time = min(max(timestamp, self.start_time), self.end_time)
        self.seek_revision += 1

    @property
    def start_time(self) -> float:
        return 0.0 if active_log_session else PLAYBACK_START_TIME

    @property
    def end_time(self) -> float:
        return active_log_session.metadata.duration_seconds if active_log_session else PLAYBACK_END_TIME


def apply_channel_filters(packet: dict, playback: PlaybackState) -> dict:
    """Remove disabled topic values while retaining a stable packet shape."""
    filtered = dict(packet)
    filtered["enabled_channels"] = sorted(playback.enabled_channels)
    if active_log_session:
        return filtered
    channel_fields = {
        "/lidar/points": ("lidar_points",),
        "/model/fusion_weight": ("model_weight",),
        "/sensors/camera_fl/glare": ("glare_index",),
        "/camera/front_left/image_raw": ("camera_frame_b64", "camera_frame_mime"),
        "/can/chassis/brake_pressure": ("can_bus_brake_pressure_psi",),
    }
    for channel, fields in channel_fields.items():
        if channel not in playback.enabled_channels:
            for field in fields:
                filtered[field] = None
    if "/diagnostics/status" not in playback.enabled_channels:
        filtered["status"] = "FILTERED"
        filtered["anomaly_detail"] = None
    return filtered


def generate_synthetic_camera_frame(glare_index: float, timestamp: float) -> str:
    """Return a Base64 JPEG representing the synchronized front-left camera."""
    image = Image.new("RGB", (320, 180), color=(15, 20, 30))
    draw = ImageDraw.Draw(image)

    draw.rectangle((0, 0, 320, 118), fill=(12, 18, 29))
    draw.line(((0, 120), (320, 120)), fill=(40, 50, 70), width=1)
    draw.polygon(((160, 120), (60, 180), (260, 180)), fill=(25, 32, 45))
    draw.line(((137, 180), (154, 126)), fill=(180, 185, 170), width=2)
    draw.line(((183, 180), (166, 126)), fill=(180, 185, 170), width=2)

    if glare_index > 0.2:
        radius = int(glare_index * 140)
        draw.ellipse(
            (160 - radius, 60 - radius, 160 + radius, 60 + radius),
            fill=(255, 255, 240),
        )

    draw.text((10, 10), f"CAM_FL // t={timestamp:.3f}s", fill=(0, 240, 255))
    if glare_index > 0.3:
        draw.text((10, 25), "SENSOR SATURATED", fill=(255, 0, 85))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=70, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def extract_compressed_image(raw_data: bytes) -> tuple[str, str] | None:
    """Find a JPEG/PNG payload inside a raw or CDR-wrapped compressed message."""
    jpeg_start = raw_data.find(b"\xff\xd8\xff")
    jpeg_end = raw_data.rfind(b"\xff\xd9")
    if jpeg_start >= 0 and jpeg_end > jpeg_start:
        frame = raw_data[jpeg_start : jpeg_end + 2]
        return base64.b64encode(frame).decode("ascii"), "image/jpeg"

    png_signature = b"\x89PNG\r\n\x1a\n"
    png_start = raw_data.find(png_signature)
    png_end = raw_data.rfind(b"IEND\xaeB`\x82")
    if png_start >= 0 and png_end > png_start:
        frame = raw_data[png_start : png_end + 8]
        return base64.b64encode(frame).decode("ascii"), "image/png"
    return None


def _numeric(data: object, *paths: str) -> float | None:
    """Read the first numeric dotted path from a decoded ROS message."""
    for path in paths:
        value = data
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                value = None
                break
            value = value[part]
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def engineering_packet(
    latest: dict[str, DecodedMessage], timestamp_ns: int, session: ROSLogSession
) -> dict:
    """Expose decoded topic frames plus best-effort dashboard summary fields."""
    frames = {topic: message.data for topic, message in latest.items()}
    lidar = next((message for topic, message in latest.items() if "point" in topic.lower()), None)
    image = next((message for topic, message in latest.items() if "image" in topic.lower()), None)
    model = next((message for topic, message in latest.items() if "weight" in topic.lower() or "confidence" in topic.lower()), None)
    glare = next((message for topic, message in latest.items() if "glare" in topic.lower()), None)
    brake = next((message for topic, message in latest.items() if "brake" in topic.lower()), None)

    lidar_points = None
    if lidar:
        width = _numeric(lidar.data, "width")
        height = _numeric(lidar.data, "height") or 1
        if width is not None:
            lidar_points = int(width * height)
    model_weight = _numeric(model.data, "data", "confidence", "value") if model else None
    glare_index = _numeric(glare.data, "data", "value", "glare_index") if glare else None
    brake_psi = _numeric(brake.data, "data", "pressure", "pressure_psi") if brake else None
    camera = extract_compressed_image(image.raw_data) if image else None
    start = 0.0
    end = session.metadata.duration_seconds
    packet = {
        "timestamp": (timestamp_ns - session.metadata.start_time_ns) / 1e9,
        "duration": session.metadata.duration_seconds,
        "start_time": start,
        "end_time": end,
        "node_id": f"UPLOAD_{session.path.stem}",
        "lidar_points": lidar_points,
        "model_weight": model_weight,
        "glare_index": glare_index,
        "can_bus_brake_pressure_psi": brake_psi,
        "status": "NOMINAL",
        "anomaly_detail": None,
        "frames": frames,
    }
    if camera:
        packet["camera_frame_b64"], packet["camera_frame_mime"] = camera
    return packet


def next_message(iterator: Iterator[DecodedMessage]) -> DecodedMessage | None:
    """Thread-friendly iterator advance (StopIteration cannot cross a Future)."""
    try:
        return next(iterator)
    except StopIteration:
        return None


def iter_uploaded_messages(log_path: Path) -> Iterator[tuple[int, bytes]]:
    """Yield recorded timestamps and raw messages from MCAP or ROS2 SQLite bags."""
    if log_path.suffix == ".mcap":
        from mcap.reader import make_reader

        with log_path.open("rb") as stream:
            reader = make_reader(stream)
            for _, _, message in reader.iter_messages():
                yield message.log_time, message.data
        return

    connection = sqlite3.connect(f"file:{log_path.as_posix()}?mode=ro", uri=True)
    try:
        cursor = connection.execute(
            "SELECT timestamp, data FROM messages ORDER BY timestamp ASC"
        )
        for timestamp, data in cursor:
            yield int(timestamp), bytes(data)
    finally:
        connection.close()


def uploaded_packet(raw_data: bytes, elapsed_seconds: float, log_path: Path) -> dict:
    """Map JSON telemetry when available; otherwise emit a nominal playback frame."""
    packet = {
        "timestamp": round(14.0 + elapsed_seconds, 3),
        "node_id": f"UPLOAD_{log_path.stem}",
        "lidar_points": 4000,
        "model_weight": 0.98,
        "glare_index": 0.05,
        "can_bus_brake_pressure_psi": 0.0,
        "status": "NOMINAL",
        "anomaly_detail": None,
        "source_file": log_path.name,
    }
    try:
        decoded = json.loads(raw_data.decode("utf-8"))
        if isinstance(decoded, dict):
            for key in TelemetryPayload.model_fields:
                if key in decoded:
                    packet[key] = decoded[key]
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    glare_index = packet.get("glare_index")
    if not isinstance(glare_index, (int, float)):
        glare_index = 0.05
    compressed_image = extract_compressed_image(raw_data)
    if compressed_image:
        packet["camera_frame_b64"], packet["camera_frame_mime"] = compressed_image
    else:
        packet.setdefault(
            "camera_frame_b64",
            generate_synthetic_camera_frame(float(glare_index), float(packet["timestamp"])),
        )
        packet.setdefault("camera_frame_mime", "image/jpeg")
    return packet


@app.get("/")
def health_check():
    return {
        "status": "VEXORIS_ENGINE_ONLINE",
        "system": "Deterministic Forensics",
    }


@app.get("/api/v1/playback-source")
def get_playback_source():
    return {
        "mode": "uploaded" if active_log_path else "simulation",
        "filename": active_log_path.name if active_log_path else None,
    }


@app.post("/api/v1/upload-log")
async def upload_log(file: UploadFile = File(...)):
    """Validate, store, and activate an MCAP or ROS2 SQLite bag for playback."""
    global active_log_path, active_log_session, active_log_revision

    original_name = Path(file.filename or "").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_LOG_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Only .mcap and .db3 files are supported")

    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    destination = UPLOAD_DIRECTORY / (
        f"{uuid4().hex}_{Path(original_name).stem}{extension}"
    )
    size = 0

    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Log file exceeds the 2 GiB limit")
                output.write(chunk)

        with destination.open("rb") as uploaded:
            signature = uploaded.read(16)
        expected_signature = b"\x89MCAP0\r\n" if extension == ".mcap" else b"SQLite format 3\x00"
        if not signature.startswith(expected_signature):
            raise HTTPException(status_code=422, detail=f"Invalid {extension} file signature")

        try:
            session = await asyncio.to_thread(ROSLogSession.open, destination)
        except (RuntimeError, sqlite3.DatabaseError, OSError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

        active_log_path = destination
        active_log_session = session
        active_log_revision += 1
        return {
            "status": "READY_FOR_PLAYBACK",
            "filename": original_name,
            "size_bytes": size,
            "start_time_ns": session.metadata.start_time_ns,
            "end_time_ns": session.metadata.end_time_ns,
            "duration_seconds": round(session.metadata.duration_seconds, 6),
            "total_messages": session.metadata.message_count,
            "topics": [
                {
                    "name": topic.name,
                    "message_type": topic.message_type,
                    "message_count": topic.message_count,
                }
                for topic in session.metadata.topics
            ],
        }
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


app.add_api_route("/api/upload", upload_log, methods=["POST"])


@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """Stream telemetry while accepting playback controls on the same socket."""
    await websocket.accept()

    playback = PlaybackState()

    async def receive_controls() -> None:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "PAUSE":
                playback.is_playing = False
            elif action == "PLAY":
                playback.is_playing = True
            elif action == "SEEK":
                try:
                    playback.seek(float(data["timestamp"]))
                except (KeyError, TypeError, ValueError):
                    continue
            elif action == "SET_SPEED":
                try:
                    speed = float(data["speed"])
                except (KeyError, TypeError, ValueError):
                    continue
                if speed in ALLOWED_PLAYBACK_SPEEDS:
                    playback.speed = speed
            elif action == "TOGGLE_CHANNEL":
                channel = data.get("channel")
                available = (
                    {topic.name for topic in active_log_session.metadata.topics}
                    if active_log_session
                    else set(AVAILABLE_CHANNELS)
                )
                if channel in available:
                    if channel in playback.enabled_channels:
                        playback.enabled_channels.remove(channel)
                    else:
                        playback.enabled_channels.add(channel)
            elif action == "SET_CHANNELS":
                channels = data.get("channels")
                if isinstance(channels, list):
                    available = (
                        {topic.name for topic in active_log_session.metadata.topics}
                        if active_log_session
                        else set(AVAILABLE_CHANNELS)
                    )
                    playback.enabled_channels = {
                        channel
                        for channel in channels
                        if isinstance(channel, str) and channel in available
                    }

    control_task = asyncio.create_task(receive_controls())

    try:
        while True:
            playback_path = active_log_path
            session = active_log_session
            if playback_path and session:
                source_revision = active_log_revision
                observed_seek_revision = playback.seek_revision
                selected_topics = set(playback.enabled_channels)
                cursor_ns = session.metadata.start_time_ns + int(
                    playback.current_time * 1_000_000_000
                )
                iterator = session.iter_messages(cursor_ns, selected_topics)
                pending = await asyncio.to_thread(next_message, iterator)
                latest: dict[str, DecodedMessage] = {}
                wall_anchor = time.monotonic()
                log_anchor_ns = cursor_ns
                observed_speed = playback.speed

                while pending is not None:
                    if (
                        source_revision != active_log_revision
                        or observed_seek_revision != playback.seek_revision
                        or selected_topics != playback.enabled_channels
                    ):
                        break
                    if not playback.is_playing:
                        wall_anchor = time.monotonic()
                        log_anchor_ns = session.metadata.start_time_ns + int(
                            playback.current_time * 1_000_000_000
                        )
                        packet = engineering_packet(latest, log_anchor_ns, session)
                        packet.update(is_playing=False, speed=playback.speed)
                        await websocket.send_json(apply_channel_filters(packet, playback))
                        await asyncio.sleep(0.05)
                        continue

                    if playback.speed != observed_speed:
                        observed_speed = playback.speed
                        wall_anchor = time.monotonic()
                        log_anchor_ns = session.metadata.start_time_ns + int(
                            playback.current_time * 1_000_000_000
                        )

                    target_ns = log_anchor_ns + int(
                        (time.monotonic() - wall_anchor) * playback.speed * 1_000_000_000
                    )
                    while pending is not None and pending.log_time_ns <= target_ns:
                        latest[pending.topic] = pending
                        pending = await asyncio.to_thread(next_message, iterator)

                    playback.current_time = min(
                        (target_ns - session.metadata.start_time_ns) / 1e9,
                        playback.end_time,
                    )
                    packet = engineering_packet(latest, target_ns, session)
                    packet.update(
                        is_playing=playback.is_playing,
                        speed=playback.speed,
                    )
                    await websocket.send_json(apply_channel_filters(packet, playback))
                    await asyncio.sleep(PLAYBACK_STEP_SECONDS)

                if source_revision == active_log_revision and pending is None:
                    playback.current_time = playback.start_time
                    playback.seek_revision += 1
                continue

            timestamp = playback.current_time

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
                "duration": PLAYBACK_END_TIME - PLAYBACK_START_TIME,
                "start_time": PLAYBACK_START_TIME,
                "end_time": PLAYBACK_END_TIME,
                "is_playing": playback.is_playing,
                "speed": playback.speed,
                "node_id": "MCAP_ROS2_EDGE_8802",
                "lidar_points": lidar_points,
                "model_weight": round(model_weight, 2),
                "glare_index": round(glare, 2),
                "camera_frame_b64": generate_synthetic_camera_frame(
                    glare, timestamp
                ),
                "camera_frame_mime": "image/jpeg",
                "can_bus_brake_pressure_psi": round(brake_psi, 1),
                "status": status,
                "anomaly_detail": detail,
            }

            await websocket.send_text(json.dumps(apply_channel_filters(packet, playback)))
            if playback.is_playing:
                playback.current_time += PLAYBACK_STEP_SECONDS
                if playback.current_time > PLAYBACK_END_TIME:
                    playback.current_time = PLAYBACK_START_TIME

            await asyncio.sleep(PLAYBACK_STEP_SECONDS / playback.speed)
    except WebSocketDisconnect:
        print("[VEXORIS] Client disconnected from telemetry stream.")
    finally:
        control_task.cancel()
        await asyncio.gather(control_task, return_exceptions=True)


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
        [
            "LiDAR Point Cloud Density",
            f"{payload.lidar_points} pts" if payload.lidar_points is not None else "FILTERED",
            "> 2500 pts",
        ],
        [
            "Neural Model Weight Confidence",
            f"{payload.model_weight * 100:.0f}%" if payload.model_weight is not None else "FILTERED",
            "> 75%",
        ],
        [
            "Optical Glare Saturation Index",
            f"{payload.glare_index:.2f}" if payload.glare_index is not None else "FILTERED",
            "< 0.30",
        ],
        [
            "CAN Bus Brake Pressure",
            (
                f"{payload.can_bus_brake_pressure_psi:.1f} PSI"
                if payload.can_bus_brake_pressure_psi is not None
                else "FILTERED"
            ),
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
    if payload.status == "FILTERED":
        elements.append(
            Paragraph(
                "Diagnostic status was filtered at the selected timestamp; "
                "no fault conclusion can be drawn from this capture.",
                body_style,
            )
        )
    elif payload.anomaly_detail:
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
