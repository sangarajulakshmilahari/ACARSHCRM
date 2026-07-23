from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("acarsh_mcp.audit")


class AuditLogger:
    """Structured mutation logging without serializing CRM payloads or PII."""

    def mutation(
        self,
        *,
        tool: str,
        entity: str,
        entity_id: int | None,
        actor_user_id: int | None,
        outcome: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        logger.info(
            "mcp_mutation",
            extra={
                "mcp_tool": tool,
                "mcp_entity": entity,
                "mcp_entity_id": entity_id,
                "mcp_actor_user_id": actor_user_id,
                "mcp_outcome": outcome,
                "mcp_metadata": metadata or {},
            },
        )
