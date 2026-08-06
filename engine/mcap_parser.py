from dataclasses import dataclass, asdict
import random
from typing import Dict, Any, Generator


@dataclass
class SpatialTelemetryFrame:
    timestamp: float
    node_id: str
    sequence_id: int
    lidar_points: int
    camera_node_id: str
    model_weight: float
    glare_index: float
    can_bus_brake_pressure_psi: float
    status: str
    anomaly_detail: str | None


class McapLogEngine:
    def __init__(self, log_filepath: str = "sample_run_8802.mcap"):
        self.log_filepath = log_filepath
        self.sequence_counter = 0

    def parse_header(self) -> Dict[str, Any]:
        return {
            "format": "MCAP_ROS2_v1",
            "channels": [
                "/tf",
                "/lidar/points_raw",
                "/neural/model_weights",
                "/camera/node_2/raw",
                "/can/chassis_telemetry"
            ],
            "chunk_count": 14,
            "message_count": 14200,
            "compression": "LZ4"
        }

    def generate_log_stream(
        self,
        start_time: float = 14.000,
        end_time: float = 14.050,
    ) -> Generator[Dict[str, Any], None, None]:
        current_time = start_time

        while current_time <= end_time:
            self.sequence_counter += 1
            is_anomaly = current_time >= 14.020

            glare = 0.94 if is_anomaly else round(random.uniform(0.02, 0.05), 3)
            weight = 0.08 if is_anomaly else round(random.uniform(0.96, 0.99), 2)
            brake_psi = 1200.0 if is_anomaly else 0.0

            frame = SpatialTelemetryFrame(
                timestamp=round(current_time, 3),
                node_id="MCAP_ROS2_EDGE_8802",
                sequence_id=self.sequence_counter,
                lidar_points=4000,
                camera_node_id="CAM_OPTICAL_FRONT_LEFT",
                model_weight=weight,
                glare_index=glare,
                can_bus_brake_pressure_psi=brake_psi,
                status="CRITICAL_ANOMALY" if is_anomaly else "NOMINAL",
                anomaly_detail=(
                    "Optical Sensor Saturation at Camera Node #2"
                    if is_anomaly
                    else None
                ),
            )

            yield asdict(frame)
            current_time += 0.002
