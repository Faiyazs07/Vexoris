"""Disk-backed readers for ROS 2 MCAP and SQLite3 bag files.

The readers deliberately keep payloads on disk.  Only metadata and the latest
message for each selected topic are held in memory, so bag size is not tied to
the FastAPI worker's RAM usage.
"""

from __future__ import annotations

import base64
import dataclasses
import math
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class TopicInfo:
    name: str
    message_type: str
    message_count: int = 0


@dataclass(frozen=True)
class LogMetadata:
    start_time_ns: int
    end_time_ns: int
    message_count: int
    topics: tuple[TopicInfo, ...]

    @property
    def duration_seconds(self) -> float:
        return max(0, self.end_time_ns - self.start_time_ns) / 1_000_000_000


@dataclass(frozen=True)
class DecodedMessage:
    topic: str
    message_type: str
    log_time_ns: int
    data: Any
    raw_data: bytes


def json_safe(value: Any, *, max_array_items: int = 4096) -> Any:
    """Convert generated ROS message objects and numpy values to JSON values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return {
            "encoding": "base64",
            "size": len(raw),
            "data": base64.b64encode(raw[:max_array_items]).decode("ascii"),
            "truncated": len(raw) > max_array_items,
        }
    if dataclasses.is_dataclass(value):
        return {
            field.name: json_safe(getattr(value, field.name), max_array_items=max_array_items)
            for field in dataclasses.fields(value)
        }
    if isinstance(value, Mapping):
        return {
            str(key): json_safe(item, max_array_items=max_array_items)
            for key, item in value.items()
        }
    if hasattr(value, "tolist"):
        return json_safe(value.tolist(), max_array_items=max_array_items)
    if isinstance(value, Sequence):
        items = value[:max_array_items]
        return [json_safe(item, max_array_items=max_array_items) for item in items]
    slots = getattr(value, "__slots__", ())
    if slots:
        return {
            slot.lstrip("_"): json_safe(getattr(value, slot), max_array_items=max_array_items)
            for slot in slots
            if hasattr(value, slot)
        }
    return str(value)


class ROSLogSession:
    def __init__(self, path: Path):
        self.path = path
        self.metadata = self._read_metadata()

    @classmethod
    def open(cls, path: str | Path) -> "ROSLogSession":
        log_path = Path(path)
        if log_path.suffix.lower() == ".mcap":
            return MCAPLogSession(log_path)
        if log_path.suffix.lower() == ".db3":
            return DB3LogSession(log_path)
        raise ValueError("Only .mcap and .db3 files are supported")

    def _read_metadata(self) -> LogMetadata:
        raise NotImplementedError

    def iter_messages(
        self, start_time_ns: int, topics: set[str] | None = None
    ) -> Iterator[DecodedMessage]:
        raise NotImplementedError


class MCAPLogSession(ROSLogSession):
    def _read_metadata(self) -> LogMetadata:
        try:
            from mcap.reader import make_reader
        except ImportError as error:
            raise RuntimeError("MCAP support is not installed; install engine/requirements.txt") from error

        with self.path.open("rb") as stream:
            reader = make_reader(stream)
            summary = reader.get_summary()
            if summary is None or summary.statistics is None:
                raise ValueError("MCAP has no readable summary/index")
            stats = summary.statistics
            counts = dict(stats.channel_message_counts or {})
            topics = tuple(
                TopicInfo(
                    name=channel.topic,
                    message_type=(summary.schemas[channel.schema_id].name if channel.schema_id else "unknown"),
                    message_count=int(counts.get(channel_id, 0)),
                )
                for channel_id, channel in summary.channels.items()
            )
            return LogMetadata(
                start_time_ns=int(stats.message_start_time),
                end_time_ns=int(stats.message_end_time),
                message_count=int(stats.message_count),
                topics=tuple(sorted(topics, key=lambda topic: topic.name)),
            )

    def iter_messages(
        self, start_time_ns: int, topics: set[str] | None = None
    ) -> Iterator[DecodedMessage]:
        from mcap.reader import make_reader
        from mcap_ros2.decoder import Decoder

        decoder = Decoder()
        with self.path.open("rb") as stream:
            reader = make_reader(stream)
            for schema, channel, message in reader.iter_messages(
                topics=sorted(topics) if topics else None,
                start_time=max(start_time_ns, self.metadata.start_time_ns),
            ):
                try:
                    decoded = decoder.decode(schema, message)
                    data = json_safe(decoded)
                except Exception as error:
                    data = {"decode_error": str(error), "size": len(message.data)}
                yield DecodedMessage(
                    topic=channel.topic,
                    message_type=schema.name if schema else "unknown",
                    log_time_ns=int(message.log_time),
                    data=data,
                    raw_data=message.data,
                )


class DB3LogSession(ROSLogSession):
    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(f"file:{self.path.as_posix()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    def _read_metadata(self) -> LogMetadata:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT t.name, t.type, COUNT(m.id) AS message_count,
                          MIN(m.timestamp) AS start_time, MAX(m.timestamp) AS end_time
                   FROM topics t LEFT JOIN messages m ON m.topic_id = t.id
                   GROUP BY t.id, t.name, t.type ORDER BY t.name"""
            ).fetchall()
        nonempty = [row for row in rows if row["start_time"] is not None]
        if not nonempty:
            raise ValueError("DB3 bag contains no readable messages")
        return LogMetadata(
            start_time_ns=min(int(row["start_time"]) for row in nonempty),
            end_time_ns=max(int(row["end_time"]) for row in nonempty),
            message_count=sum(int(row["message_count"]) for row in rows),
            topics=tuple(
                TopicInfo(row["name"], row["type"], int(row["message_count"])) for row in rows
            ),
        )

    def iter_messages(
        self, start_time_ns: int, topics: set[str] | None = None
    ) -> Iterator[DecodedMessage]:
        try:
            from rosbags.typesys import Stores, get_typestore
        except ImportError as error:
            raise RuntimeError("DB3 decoding support is not installed; install engine/requirements.txt") from error

        typestore = get_typestore(Stores.LATEST)
        params: list[Any] = [max(start_time_ns, self.metadata.start_time_ns)]
        topic_clause = ""
        if topics:
            placeholders = ",".join("?" for _ in topics)
            topic_clause = f" AND t.name IN ({placeholders})"
            params.extend(sorted(topics))
        query = (
            "SELECT m.timestamp, m.data, t.name, t.type FROM messages m "
            "JOIN topics t ON t.id=m.topic_id WHERE m.timestamp >= ?"
            f"{topic_clause} ORDER BY m.timestamp ASC"
        )
        with self._connect() as connection:
            for row in connection.execute(query, params):
                raw = bytes(row["data"])
                try:
                    decoded = typestore.deserialize_cdr(raw, row["type"])
                    data = json_safe(decoded)
                except Exception as error:
                    data = {"decode_error": str(error), "size": len(raw)}
                yield DecodedMessage(row["name"], row["type"], int(row["timestamp"]), data, raw)
