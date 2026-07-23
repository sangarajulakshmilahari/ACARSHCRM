from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastmcp.server.dependencies import get_http_headers

from acarsh_mcp.config import Settings
from acarsh_mcp.errors import AccessDeniedError, ConfigurationError

MANAGER_ROLE_ID = 1
SALES_EXECUTIVE_ROLE_ID = 2
ROLE_NAMES = {
    MANAGER_ROLE_ID: "Manager",
    SALES_EXECUTIVE_ROLE_ID: "Sales Executive",
}


@dataclass(frozen=True, slots=True)
class ActorContext:
    user_id: int
    role_id: int
    user_name: str = ""

    @property
    def role_name(self) -> str:
        return ROLE_NAMES[self.role_id]

    @property
    def is_manager(self) -> bool:
        return self.role_id == MANAGER_ROLE_ID


@dataclass(frozen=True, slots=True)
class AccessScope:
    clauses: tuple[str, ...] = ()
    params: dict[str, int] | None = None


class ActorProvider:
    """Resolve an actor from trusted HTTP headers or explicit STDIO defaults."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def current(self, *, required: bool = True) -> ActorContext | None:
        headers = get_http_headers()
        raw_user_id = headers.get("x-acarsh-user-id", "").strip()
        raw_role_id = headers.get("x-acarsh-role-id", "").strip()

        if raw_user_id or raw_role_id:
            configured = self.settings.internal_token.get_secret_value()
            supplied = headers.get("x-acarsh-internal-token", "")
            if not configured:
                raise ConfigurationError(
                    "ACARSH_MCP_INTERNAL_TOKEN must be configured before accepting "
                    "HTTP actor context"
                )
            if not hmac.compare_digest(configured, supplied):
                raise AccessDeniedError("The MCP caller is not trusted to provide actor context")
            try:
                user_id = int(raw_user_id)
                role_id = int(raw_role_id)
            except ValueError as exc:
                raise AccessDeniedError("Invalid actor context") from exc
            return self._validated(
                user_id,
                role_id,
                headers.get("x-acarsh-user-name", "").strip(),
            )

        if self.settings.default_actor_user_id and self.settings.default_actor_role_id:
            return self._validated(
                self.settings.default_actor_user_id,
                self.settings.default_actor_role_id,
                "",
            )

        if required:
            raise AccessDeniedError(
                "No actor context is available; connect through the authenticated chatbot "
                "or configure both default actor settings for STDIO"
            )
        return None

    @staticmethod
    def _validated(user_id: int, role_id: int, user_name: str) -> ActorContext:
        if user_id <= 0 or role_id not in ROLE_NAMES:
            raise AccessDeniedError("Unsupported user or role in actor context")
        return ActorContext(user_id=user_id, role_id=role_id, user_name=user_name)


class AccessPolicy:
    """Map application entities to SQL predicates enforced below the LLM layer."""

    _SALES_SCOPES = {
        "leads": "l.OwnerId = :scope_user_id",
        "contacts": "l.OwnerId = :scope_user_id",
        "activities": "(l.OwnerId = :scope_user_id OR a.CreatedBy = :scope_user_id)",
        "reminders": "(l.OwnerId = :scope_user_id OR r.CreatedBy = :scope_user_id)",
        "opportunities": "l.OwnerId = :scope_user_id",
        "opportunity_contacts": "l.OwnerId = :scope_user_id",
        "projects": "l.OwnerId = :scope_user_id",
        "project_contacts": "l.OwnerId = :scope_user_id",
        "project_resources": "l.OwnerId = :scope_user_id",
        "users": "u.UserId = :scope_user_id",
    }

    @classmethod
    def for_entity(cls, entity: str, actor: ActorContext) -> AccessScope:
        if actor.is_manager:
            return AccessScope()
        clause = cls._SALES_SCOPES.get(entity)
        if not clause:
            raise AccessDeniedError(f"Role {actor.role_name} cannot query entity '{entity}'")
        return AccessScope(clauses=(clause,), params={"scope_user_id": actor.user_id})
