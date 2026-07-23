from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings. Secrets are never read from the Next.js source tree."""

    model_config = SettingsConfigDict(
        env_prefix="ACARSH_MCP_",
        env_file=(PACKAGE_ROOT / "config.env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    db_host: str = "127.0.0.1"
    db_port: int = Field(default=3306, ge=1, le=65535)
    db_user: str = "acarsh_mcp"
    db_password: SecretStr = SecretStr("")
    db_name: str = "acarsh_db"

    transport: Literal["stdio", "http", "sse"] = "stdio"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    http_path: str = "/mcp"

    default_actor_user_id: int | None = Field(default=None, gt=0)
    default_actor_role_id: int | None = Field(default=None, gt=0)
    internal_token: SecretStr = SecretStr("")
    max_page_size: int = Field(default=100, ge=1, le=500)
    query_timeout_seconds: int = Field(default=15, ge=1, le=120)
    input_timezone: str = "Asia/Kolkata"
    log_level: str = "INFO"

    @property
    def sqlalchemy_url(self) -> URL:
        return URL.create(
            "mysql+pymysql",
            username=self.db_user,
            password=self.db_password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
            query={"charset": "utf8mb4"},
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
