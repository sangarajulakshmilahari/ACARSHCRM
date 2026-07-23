from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import Connection

from acarsh_mcp.config import Settings


def json_value(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def json_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {str(key): json_value(value) for key, value in row.items()}


class Database:
    """Small SQLAlchemy boundary shared by query and command services."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._engine: Engine | None = None

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._engine = create_engine(
                self.settings.sqlalchemy_url,
                pool_pre_ping=True,
                pool_recycle=1800,
                pool_size=5,
                max_overflow=10,
                connect_args={
                    "connect_timeout": 5,
                    "read_timeout": self.settings.query_timeout_seconds,
                    "write_timeout": self.settings.query_timeout_seconds,
                },
            )

            timeout_ms = self.settings.query_timeout_seconds * 1000

            @event.listens_for(self._engine, "connect")
            def configure_connection(dbapi_connection: Any, _connection_record: Any) -> None:
                cursor = dbapi_connection.cursor()
                try:
                    cursor.execute(f"SET SESSION MAX_EXECUTION_TIME = {timeout_ms}")
                    cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                finally:
                    cursor.close()

        return self._engine

    def ping(self) -> bool:
        with self.engine.connect() as conn:
            return bool(conn.execute(text("SELECT 1")).scalar_one())

    def fetch_all(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(text(sql), params or {}).mappings().all()
            return [json_row(row) for row in rows]

    def fetch_one(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        with self.engine.connect() as conn:
            row = conn.execute(text(sql), params or {}).mappings().first()
            return json_row(row) if row is not None else None

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        with self.engine.begin() as conn:
            yield conn

    def dispose(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
