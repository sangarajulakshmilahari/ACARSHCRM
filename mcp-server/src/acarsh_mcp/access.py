from __future__ import annotations

import hmac
from collections.abc import Callable
from dataclasses import dataclass

from fastmcp.server.dependencies import get_http_headers

from acarsh_mcp.config import Settings
from acarsh_mcp.errors import AccessDeniedError, ConfigurationError

MANAGER_ROLE_ID = 1
SALES_EXECUTIVE_ROLE_ID = 2
ADMIN_ROLE_ID = 3
ROLE_NAMES = {
    MANAGER_ROLE_ID: "Manager",
    SALES_EXECUTIVE_ROLE_ID: "Sales Executive",
    ADMIN_ROLE_ID: "Admin",
}


@dataclass(frozen=True, slots=True)
class ActorContext:
    user_id: int
    role_id: int
    user_name: str = ""
    company_id: int | None = None

    @property
    def role_name(self) -> str:
        return ROLE_NAMES[self.role_id]

    @property
    def is_manager(self) -> bool:
        return self.role_id in {MANAGER_ROLE_ID, ADMIN_ROLE_ID}


@dataclass(frozen=True, slots=True)
class AccessScope:
    clauses: tuple[str, ...] = ()
    params: dict[str, int] | None = None


@dataclass(frozen=True, slots=True)
class CompanyMembership:
    company_id: int
    role_id: int
    is_default: bool = False


MembershipLoader = Callable[[int], list[CompanyMembership]]


class ActorProvider:
    """Resolve an actor from trusted HTTP headers or explicit STDIO defaults."""

    def __init__(
        self,
        settings: Settings,
        *,
        memberships_for_user: MembershipLoader | None = None,
    ) -> None:
        self.settings = settings
        self.memberships_for_user = memberships_for_user

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
                raw_company_id = headers.get("x-acarsh-company-id", "").strip()
                requested_company_id = int(raw_company_id) if raw_company_id else None
            except ValueError as exc:
                raise AccessDeniedError("Invalid actor context") from exc
            company_id, role_id = self._authorized_company(user_id, requested_company_id)
            return self._validated(
                user_id,
                role_id,
                headers.get("x-acarsh-user-name", "").strip(),
                company_id,
            )

        if self.settings.default_actor_user_id:
            company_id, role_id = self._authorized_company(
                self.settings.default_actor_user_id,
                self.settings.default_actor_company_id,
            )
            return self._validated(
                self.settings.default_actor_user_id,
                role_id,
                "",
                company_id,
            )

        if required:
            raise AccessDeniedError(
                "No actor context is available; connect through the authenticated chatbot "
                "or configure default actor user and company settings for STDIO"
            )
        return None

    def _authorized_company(
        self,
        user_id: int,
        requested_company_id: int | None,
    ) -> tuple[int, int]:
        if requested_company_id is None or requested_company_id <= 0:
            raise AccessDeniedError("Company membership required")
        if self.memberships_for_user is None:
            raise AccessDeniedError("Company membership required")
        memberships = [
            row
            for row in self.memberships_for_user(user_id)
            if row.company_id > 0 and row.role_id in ROLE_NAMES
        ]
        if not memberships:
            raise AccessDeniedError("Company membership required")
        match = next((row for row in memberships if row.company_id == requested_company_id), None)
        if match is None:
            raise AccessDeniedError("User is not a member of the requested company")
        return match.company_id, match.role_id

    @staticmethod
    def _validated(
        user_id: int,
        role_id: int,
        user_name: str,
        company_id: int | None = None,
    ) -> ActorContext:
        if user_id <= 0 or role_id not in ROLE_NAMES:
            raise AccessDeniedError("Unsupported user or role in actor context")
        if company_id is not None and company_id <= 0:
            raise AccessDeniedError("Invalid actor company context")
        return ActorContext(
            user_id=user_id,
            role_id=role_id,
            user_name=user_name,
            company_id=company_id,
        )


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

    _TENANT_SCOPES = {
        "leads": "l.CompanyId = :scope_company_id",
        "contacts": "c.CompanyId = :scope_company_id",
        "activities": "a.CompanyId = :scope_company_id",
        "reminders": "r.CompanyId = :scope_company_id",
        "opportunities": "o.CompanyId = :scope_company_id",
        "opportunity_contacts": "c.CompanyId = :scope_company_id",
        "projects": "p.CompanyId = :scope_company_id",
        "project_contacts": "c.CompanyId = :scope_company_id",
        "project_resources": "r.CompanyId = :scope_company_id",
        "users": (
            "EXISTS (SELECT 1 FROM CompanyUsers cu "
            "WHERE cu.UserId = u.UserId AND cu.CompanyId = :scope_company_id AND cu.IsActive = 1)"
        ),
    }

    @classmethod
    def for_entity(cls, entity: str, actor: ActorContext) -> AccessScope:
        clauses: list[str] = []
        params: dict[str, int] = {}
        tenant = cls._TENANT_SCOPES.get(entity)
        if tenant:
            if not actor.company_id:
                raise AccessDeniedError("Company membership required")
            clauses.append(tenant)
            params["scope_company_id"] = actor.company_id
        if not actor.is_manager:
            clause = cls._SALES_SCOPES.get(entity)
            if not clause:
                raise AccessDeniedError(f"Role {actor.role_name} cannot query entity '{entity}'")
            clauses.append(clause)
            params["scope_user_id"] = actor.user_id
        return AccessScope(clauses=tuple(clauses), params=params or None)
