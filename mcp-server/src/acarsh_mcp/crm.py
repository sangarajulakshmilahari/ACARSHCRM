from __future__ import annotations

import logging
import json
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.engine import Connection

from acarsh_mcp.access import ActorContext, ActorProvider
from acarsh_mcp.audit import AuditLogger
from acarsh_mcp.catalog import get_lookup
from acarsh_mcp.config import Settings
from acarsh_mcp.db import Database
from acarsh_mcp.errors import AccessDeniedError, ConflictError, NotFoundError, ValidationError
from acarsh_mcp.lead_scoring import calculate_and_store_lead_score
from acarsh_mcp.models import (
    ActivityDraft,
    ActivityUpdate,
    ContactDraft,
    ContactUpdate,
    LeadDraft,
    LeadUpdate,
    OpportunityContactDraft,
    OpportunityContactUpdate,
    OpportunityDraft,
    OpportunityUpdate,
    ProjectContactDraft,
    ProjectContactUpdate,
    ProjectDraft,
    ProjectResourceDraft,
    ProjectResourceUpdate,
    ProjectUpdate,
    RecordReference,
    ReminderDraft,
    ReminderUpdate,
)
from acarsh_mcp.query import QueryService

logger = logging.getLogger("acarsh_mcp")

QUESTIONS = {
    "company_name": "What is the company or organization name?",
    "name": "What name should be used?",
    "activity_type": "What kind of activity was this (call, email, meeting, etc.)?",
    "notes": "What notes should be recorded?",
    "status": "What status should this use?",
    "reminder_date": "When should the reminder occur? Please include a timezone.",
    "note": "What should the reminder say?",
    "service": "Which service is this opportunity for?",
    "probability": "What probability range should be assigned?",
    "engagement_model": "Which engagement model applies?",
    "full_name": "What is the contact's full name?",
    "contact_type": "What project contact type should be used?",
    "employee_id": "What employee id should be assigned?",
}


def needs_input(entity: str, missing_fields: list[str], draft: dict[str, Any]) -> dict:
    questions = []
    for name in missing_fields:
        base_name = name.rsplit(".", maxsplit=1)[-1]
        questions.append(
            {
                "field": name,
                "question": QUESTIONS.get(base_name, f"Please provide {name}."),
            }
        )
    return {
        "status": "needs_input",
        "entity": entity,
        "missing_fields": missing_fields,
        "questions": questions,
        "draft": draft,
    }


class CRMService:
    def __init__(
        self,
        database: Database,
        queries: QueryService,
        settings: Settings,
        audit: AuditLogger | None = None,
        actors: ActorProvider | None = None,
    ) -> None:
        self.database = database
        self.queries = queries
        self.settings = settings
        self.audit = audit or AuditLogger()
        self.actors = actors or ActorProvider(settings)

    def _actor(self) -> ActorContext:
        actor = self.actors.current()
        assert actor is not None
        return actor

    def _require_company_id(
        self,
        conn: Connection,
        actor: ActorContext,
        parent_company_id: int | None = None,
    ) -> int:
        company_id = actor.company_id
        if not company_id:
            raise AccessDeniedError("Company membership required")
        if parent_company_id is not None and int(parent_company_id) != int(company_id):
            raise AccessDeniedError("Cross-company write is not allowed")
        member = conn.execute(
            text(
                """
                SELECT 1
                FROM CompanyUsers
                WHERE UserId = :user_id AND CompanyId = :company_id AND IsActive = 1
                LIMIT 1
                """
            ),
            {"user_id": actor.user_id, "company_id": company_id},
        ).first()
        if member is None:
            raise AccessDeniedError("User is not a member of the requested company")
        return int(company_id)

    def _recalculate_lead_score(self, conn: Connection, lead_id: int) -> None:
        try:
            calculate_and_store_lead_score(conn, lead_id)
        except Exception:
            logger.exception("Lead score recalculation failed for lead_id=%s", lead_id)

    def calculate_lead_score(self, lead_id: RecordReference) -> dict:
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            score_data = calculate_and_store_lead_score(conn, resolved_lead_id)
            row = (
                conn.execute(
                    text(
                        """
                        SELECT Score, Rating, Breakdown, CalculatedAt
                        FROM LeadScores
                        WHERE LeadId = :lead_id
                        LIMIT 1
                        """
                    ),
                    {"lead_id": resolved_lead_id},
                )
                .mappings()
                .first()
            )
        breakdown = score_data["breakdown"]
        score = int(score_data["score"])
        rating = str(score_data["rating"])
        calculated_at = None
        if row is not None:
            score = int(row["Score"])
            rating = str(row["Rating"])
            calculated_at = row.get("CalculatedAt")
            raw_breakdown = row.get("Breakdown")
            if isinstance(raw_breakdown, str):
                try:
                    breakdown = json.loads(raw_breakdown)
                except Exception:
                    breakdown = score_data["breakdown"]
            elif isinstance(raw_breakdown, dict):
                breakdown = raw_breakdown
        return {
            "status": "ok",
            "lead_id": resolved_lead_id,
            "score": score,
            "rating": rating,
            "rating_label": (
                "HOT 🔥" if rating == "HOT" else "WARM 🟠" if rating == "WARM" else "COLD 🔵"
            ),
            "breakdown": breakdown,
            "calculated_at": calculated_at,
        }

    @staticmethod
    def _ensure_lead_access(
        conn: Connection,
        lead_id: int,
        actor: ActorContext,
        *,
        label: str = "Lead",
    ) -> None:
        row = (
            conn.execute(
                text(
                    "SELECT OwnerId FROM Leads "
                    "WHERE LeadId = :lead_id AND COALESCE(IsDeleted, 0) = 0 LIMIT 1"
                ),
                {"lead_id": lead_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise NotFoundError(f"{label} {lead_id} was not found")
        if not actor.is_manager and int(row["OwnerId"] or 0) != actor.user_id:
            raise AccessDeniedError(f"You do not have access to {label.lower()} {lead_id}")

    @classmethod
    def _ensure_project_access(cls, conn: Connection, project_id: int, actor: ActorContext) -> None:
        row = (
            conn.execute(
                text(
                    "SELECT p.CustomerId FROM Projects p "
                    "WHERE p.ProjectId = :project_id AND COALESCE(p.IsDeleted, 0) = 0 LIMIT 1"
                ),
                {"project_id": project_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise NotFoundError(f"Project {project_id} was not found")
        cls._ensure_lead_access(conn, int(row["CustomerId"]), actor, label="Customer")

    @classmethod
    def _ensure_opportunity_access(
        cls, conn: Connection, opportunity_id: int, actor: ActorContext
    ) -> None:
        row = (
            conn.execute(
                text(
                    "SELECT o.LeadId FROM Opportunities o "
                    "WHERE o.OpportunityId = :opportunity_id "
                    "AND COALESCE(o.IsDeleted, 0) = 0 LIMIT 1"
                ),
                {"opportunity_id": opportunity_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise NotFoundError(f"Opportunity {opportunity_id} was not found")
        cls._ensure_lead_access(conn, int(row["LeadId"]), actor)

    @staticmethod
    def _numeric_reference(reference: RecordReference) -> int | None:
        if isinstance(reference, int):
            return reference
        normalized = reference.strip()
        if normalized.isdigit():
            value = int(normalized)
            if value > 0:
                return value
        return None

    @staticmethod
    def _choose_named_reference(
        *,
        reference: str,
        rows: list[dict[str, Any]],
        id_field: str,
        name_fields: tuple[str, ...],
        label: str,
    ) -> int:
        normalized = reference.casefold()
        exact = [
            row
            for row in rows
            if any(str(row.get(field) or "").casefold() == normalized for field in name_fields)
        ]
        if len(exact) == 1:
            return int(exact[0][id_field])
        if not exact and len(rows) == 1:
            return int(rows[0][id_field])
        if not rows:
            raise NotFoundError(f"No accessible {label.lower()} matched '{reference}'")
        candidates = [
            {
                "id": int(row[id_field]),
                "name": next(
                    (str(row[field]) for field in name_fields if row.get(field)),
                    str(row[id_field]),
                ),
            }
            for row in rows[:5]
        ]
        raise ConflictError(
            f"'{reference}' matches more than one {label.lower()}; "
            "use an id or a more specific name",
            details={"candidates": candidates},
        )

    @classmethod
    def _resolve_lead_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        actor: ActorContext,
        *,
        label: str = "Lead",
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_lead_access(conn, numeric, actor, label=label)
            return numeric

        scope_sql = "" if actor.is_manager else " AND l.OwnerId = :scope_user_id"
        params: dict[str, Any] = {"reference": str(reference), "contains": f"%{reference}%"}
        if not actor.is_manager:
            params["scope_user_id"] = actor.user_id
        rows = list(
            conn.execute(
                text(
                    "SELECT l.LeadId AS id, l.CompanyName AS name FROM Leads l "
                    "WHERE COALESCE(l.IsDeleted, 0) = 0 "
                    "AND LOWER(l.CompanyName) LIKE LOWER(:contains)"
                    f"{scope_sql} "
                    "ORDER BY CASE WHEN LOWER(l.CompanyName) = LOWER(:reference) "
                    "THEN 0 ELSE 1 END, "
                    "l.CompanyName, l.LeadId LIMIT 6"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label=label,
        )

    @classmethod
    def _resolve_project_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        actor: ActorContext,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_project_access(conn, numeric, actor)
            return numeric

        scope_sql = "" if actor.is_manager else " AND l.OwnerId = :scope_user_id"
        params: dict[str, Any] = {"reference": str(reference), "contains": f"%{reference}%"}
        if not actor.is_manager:
            params["scope_user_id"] = actor.user_id
        rows = list(
            conn.execute(
                text(
                    "SELECT p.ProjectId AS id, p.ProjectName AS name, p.ProjectCode AS code "
                    "FROM Projects p INNER JOIN Leads l ON l.LeadId = p.CustomerId "
                    "WHERE COALESCE(p.IsDeleted, 0) = 0 AND COALESCE(l.IsDeleted, 0) = 0 "
                    "AND (LOWER(p.ProjectName) LIKE LOWER(:contains) "
                    "OR LOWER(p.ProjectCode) LIKE LOWER(:contains))"
                    f"{scope_sql} "
                    "ORDER BY CASE WHEN LOWER(p.ProjectName) = LOWER(:reference) "
                    "OR LOWER(p.ProjectCode) = LOWER(:reference) THEN 0 ELSE 1 END, "
                    "p.ProjectName, p.ProjectId LIMIT 6"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name", "code"),
            label="Project",
        )

    @classmethod
    def _resolve_opportunity_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        actor: ActorContext,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_opportunity_access(conn, numeric, actor)
            return numeric

        scope_sql = "" if actor.is_manager else " AND l.OwnerId = :scope_user_id"
        params: dict[str, Any] = {"reference": str(reference), "contains": f"%{reference}%"}
        if not actor.is_manager:
            params["scope_user_id"] = actor.user_id
        rows = list(
            conn.execute(
                text(
                    "SELECT o.OpportunityId AS id, l.CompanyName AS company, "
                    "CONCAT(l.CompanyName, ' opportunity ', o.OpportunityId) AS name "
                    "FROM Opportunities o INNER JOIN Leads l ON l.LeadId = o.LeadId "
                    "WHERE COALESCE(o.IsDeleted, 0) = 0 AND COALESCE(l.IsDeleted, 0) = 0 "
                    "AND LOWER(l.CompanyName) LIKE LOWER(:contains)"
                    f"{scope_sql} "
                    "ORDER BY CASE WHEN LOWER(l.CompanyName) = LOWER(:reference) "
                    "THEN 0 ELSE 1 END, "
                    "o.OpportunityId DESC LIMIT 6"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("company",),
            label="Opportunity",
        )

    @classmethod
    def _resolve_contact_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        lead_id: int,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_exists(
                conn,
                table="LeadContacts",
                id_column="LeadContactID",
                record_id=numeric,
                label="Contact",
                extra_sql="AND LeadId = :lead_id",
                extra_params={"lead_id": lead_id},
            )
            return numeric

        rows = list(
            conn.execute(
                text(
                    "SELECT LeadContactID AS id, ContactName AS name FROM LeadContacts "
                    "WHERE LeadId = :lead_id AND LOWER(ContactName) LIKE LOWER(:contains) "
                    "ORDER BY CASE WHEN LOWER(ContactName) = LOWER(:reference) THEN 0 ELSE 1 END, "
                    "ContactName, LeadContactID LIMIT 6"
                ),
                {
                    "lead_id": lead_id,
                    "reference": str(reference),
                    "contains": f"%{reference}%",
                },
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label="Contact",
        )

    @classmethod
    def _resolve_user_reference(cls, conn: Connection, reference: RecordReference) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_exists(
                conn,
                table="Users",
                id_column="UserId",
                record_id=numeric,
                label="User",
            )
            return numeric

        rows = list(
            conn.execute(
                text(
                    "SELECT UserId AS id, UserName AS name FROM Users "
                    "WHERE LOWER(UserName) LIKE LOWER(:contains) "
                    "ORDER BY CASE WHEN LOWER(UserName) = LOWER(:reference) THEN 0 ELSE 1 END, "
                    "UserName, UserId LIMIT 6"
                ),
                {"reference": str(reference), "contains": f"%{reference}%"},
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label="User",
        )

    @classmethod
    def _resolve_opportunity_contact_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        opportunity_id: int,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_exists(
                conn,
                table="OpportunityContacts",
                id_column="OpportunityContactId",
                record_id=numeric,
                label="Opportunity contact",
                extra_sql="AND OpportunityId = :opportunity_id AND COALESCE(IsDeleted, 0) = 0",
                extra_params={"opportunity_id": opportunity_id},
            )
            return numeric

        rows = list(
            conn.execute(
                text(
                    "SELECT OpportunityContactId AS id, FullName AS name "
                    "FROM OpportunityContacts WHERE OpportunityId = :opportunity_id "
                    "AND COALESCE(IsDeleted, 0) = 0 "
                    "AND LOWER(FullName) LIKE LOWER(:contains) "
                    "ORDER BY CASE WHEN LOWER(FullName) = LOWER(:reference) THEN 0 ELSE 1 END, "
                    "FullName, OpportunityContactId LIMIT 6"
                ),
                {
                    "opportunity_id": opportunity_id,
                    "reference": str(reference),
                    "contains": f"%{reference}%",
                },
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label="Opportunity contact",
        )

    @classmethod
    def _resolve_project_contact_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        project_id: int,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_exists(
                conn,
                table="ProjectContacts",
                id_column="ContactId",
                record_id=numeric,
                label="Project contact",
                extra_sql="AND ProjectId = :project_id",
                extra_params={"project_id": project_id},
            )
            return numeric
        rows = list(
            conn.execute(
                text(
                    "SELECT ContactId AS id, ContactName AS name FROM ProjectContacts "
                    "WHERE ProjectId = :project_id "
                    "AND LOWER(ContactName) LIKE LOWER(:contains) "
                    "ORDER BY CASE WHEN LOWER(ContactName) = LOWER(:reference) "
                    "THEN 0 ELSE 1 END, ContactName, ContactId LIMIT 6"
                ),
                {
                    "project_id": project_id,
                    "reference": str(reference),
                    "contains": f"%{reference}%",
                },
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label="Project contact",
        )

    @classmethod
    def _resolve_project_resource_reference(
        cls,
        conn: Connection,
        reference: RecordReference,
        project_id: int,
    ) -> int:
        numeric = cls._numeric_reference(reference)
        if numeric is not None:
            cls._ensure_exists(
                conn,
                table="ProjectResources",
                id_column="ResourceId",
                record_id=numeric,
                label="Project resource",
                extra_sql="AND ProjectId = :project_id",
                extra_params={"project_id": project_id},
            )
            return numeric
        rows = list(
            conn.execute(
                text(
                    "SELECT ResourceId AS id, EmployeeId AS name FROM ProjectResources "
                    "WHERE ProjectId = :project_id "
                    "AND LOWER(EmployeeId) LIKE LOWER(:contains) "
                    "ORDER BY CASE WHEN LOWER(EmployeeId) = LOWER(:reference) "
                    "THEN 0 ELSE 1 END, EmployeeId, ResourceId LIMIT 6"
                ),
                {
                    "project_id": project_id,
                    "reference": str(reference),
                    "contains": f"%{reference}%",
                },
            )
            .mappings()
            .all()
        )
        return cls._choose_named_reference(
            reference=str(reference),
            rows=rows,
            id_field="id",
            name_fields=("name",),
            label="Project resource",
        )

    @staticmethod
    def _ensure_exists(
        conn: Connection,
        *,
        table: str,
        id_column: str,
        record_id: int,
        label: str,
        extra_sql: str = "",
        extra_params: dict[str, Any] | None = None,
    ) -> None:
        params = {"record_id": record_id, **(extra_params or {})}
        row = conn.execute(
            text(
                f"SELECT {id_column} FROM {table} "
                f"WHERE {id_column} = :record_id {extra_sql} LIMIT 1"
            ),
            params,
        ).first()
        if row is None:
            raise NotFoundError(f"{label} {record_id} was not found")

    @staticmethod
    def _resolve_lookup(conn: Connection, lookup_name: str, value: str | int) -> int:
        table, id_column, label_column = get_lookup(lookup_name)
        if isinstance(value, int):
            row = (
                conn.execute(
                    text(
                        f"SELECT {id_column} AS id FROM {table} WHERE {id_column} = :value LIMIT 1"
                    ),
                    {"value": value},
                )
                .mappings()
                .first()
            )
        else:
            row = (
                conn.execute(
                    text(
                        f"SELECT {id_column} AS id FROM {table} "
                        f"WHERE LOWER({label_column}) = LOWER(:value) LIMIT 1"
                    ),
                    {"value": value.strip()},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise ValidationError(
                f"Unknown {lookup_name} value '{value}'",
                details={
                    "lookup": lookup_name,
                    "hint": f"Call list_lookup_values('{lookup_name}')",
                },
            )
        return int(row["id"])

    def list_lookup(self, lookup_name: str) -> dict:
        # Intentionally global catalog (statuses, roles, services, technologies).
        # Not tenant-owned. Do not add CompanyId filters here.
        table, id_column, label_column = get_lookup(lookup_name)
        rows = self.database.fetch_all(
            f"SELECT {id_column} AS id, {label_column} AS name FROM {table} ORDER BY {label_column}"
        )
        return {"status": "ok", "lookup": lookup_name, "items": rows}

    def create_lead(self, draft: LeadDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("lead", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        actor_id = actor.user_id
        with self.database.transaction() as conn:
            account_type_id = self._resolve_lookup(conn, "account_types", draft.account_type)
            status_id = self._resolve_lookup(conn, "lead_statuses", draft.status)
            owner_id = (
                self._resolve_user_reference(conn, draft.owner_id)
                if draft.owner_id is not None
                else actor_id
            )
            if not actor.is_manager and owner_id != actor_id:
                raise AccessDeniedError("Sales Executives can only assign leads to themselves")
            company_id = self._require_company_id(conn, actor)

            result = conn.execute(
                text(
                    """
                    INSERT INTO Leads
                      (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes,
                       OwnerId, AccountTypeId, StatusId, IsDeleted, CompanyId)
                    VALUES
                      (:company_name, :company_location, :lead_source, :lead_date, :notes,
                       :owner_id, :account_type_id, :status_id, 0, :company_id)
                    """
                ),
                {
                    "company_name": draft.company_name,
                    "company_location": draft.company_location,
                    "lead_source": draft.lead_source,
                    "lead_date": draft.lead_date,
                    "notes": draft.notes,
                    "owner_id": owner_id,
                    "account_type_id": account_type_id,
                    "status_id": status_id,
                    "company_id": company_id,
                },
            )
            lead_id = int(result.lastrowid)

            for contact in draft.contacts:
                role_id = self._resolve_lookup(conn, "contact_roles", contact.role)  # type: ignore[arg-type]
                conn.execute(
                    text(
                        """
                        INSERT INTO LeadContacts
                          (LeadId, CompanyId, ContactName, ContactTitle, ContactRoleId, ContactLocation,
                           ContactEmail, ContactPhone, LinkedInProfile, EmailSent)
                        VALUES
                          (:lead_id, :company_id, :name, :title, :role_id, :location,
                           :email, :phone, :linkedin_profile, 0)
                        """
                    ),
                    {
                        "lead_id": lead_id,
                        "company_id": company_id,
                        "name": contact.name,
                        "title": contact.title,
                        "role_id": role_id,
                        "location": contact.location,
                        "email": contact.email,
                        "phone": contact.phone,
                        "linkedin_profile": contact.linkedin_profile,
                    },
                )

            self._recalculate_lead_score(conn, lead_id)

        self.audit.mutation(
            tool="create_lead",
            entity="lead",
            entity_id=lead_id,
            actor_user_id=actor_id,
            outcome="created",
            metadata={"account_type": draft.account_type, "contact_count": len(draft.contacts)},
        )
        return self.queries.get_record("leads", lead_id)

    def update_lead(self, lead_id: RecordReference, changes: LeadUpdate) -> dict:
        actor = self._actor()
        actor_id = actor.user_id
        raw = changes.model_dump(exclude_unset=True)
        assignments: dict[str, Any] = {}

        direct_columns = {
            "company_name": "CompanyName",
            "company_location": "CompanyLocation",
            "lead_source": "LeadSource",
            "lead_date": "LeadDate",
            "notes": "LeadNotes",
            "owner_id": "OwnerId",
            "industry_focus": "IndustryFocus",
            "tags": "Tags",
        }

        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            for public_name, column in direct_columns.items():
                if public_name in raw:
                    assignments[column] = raw[public_name]

            if "owner_id" in raw and raw["owner_id"] is not None:
                resolved_owner_id = self._resolve_user_reference(conn, raw["owner_id"])
                if not actor.is_manager and resolved_owner_id != actor_id:
                    raise AccessDeniedError("Sales Executives cannot reassign lead ownership")
                assignments["OwnerId"] = resolved_owner_id
            if "account_type" in raw:
                assignments["AccountTypeId"] = self._resolve_lookup(
                    conn, "account_types", raw["account_type"]
                )
            if "status" in raw:
                assignments["StatusId"] = self._resolve_lookup(conn, "lead_statuses", raw["status"])

            if not assignments:
                raise ValidationError("No updateable lead fields were supplied")

            params = {"lead_id": resolved_lead_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = value
            set_parts.append("ModifiedOn = NOW(6)")
            conn.execute(
                text(f"UPDATE Leads SET {', '.join(set_parts)} WHERE LeadId = :lead_id"),
                params,
            )

            self._recalculate_lead_score(conn, resolved_lead_id)

        self.audit.mutation(
            tool="update_lead",
            entity="lead",
            entity_id=resolved_lead_id,
            actor_user_id=actor_id,
            outcome="updated",
            metadata={"changed_fields": sorted(raw)},
        )
        return self.queries.get_record("leads", resolved_lead_id)

    def add_contact(self, draft: ContactDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("contact", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        with self.database.transaction() as conn:
            lead_id = self._resolve_lead_reference(conn, draft.lead_id, actor)
            company_id = self._require_company_id(conn, actor)
            role_id = self._resolve_lookup(conn, "contact_roles", draft.role)  # type: ignore[arg-type]
            result = conn.execute(
                text(
                    """
                    INSERT INTO LeadContacts
                      (LeadId, CompanyId, ContactName, ContactTitle, ContactRoleId, ContactLocation,
                       ContactEmail, ContactPhone, LinkedInProfile, EmailSent)
                    VALUES
                      (:lead_id, :company_id, :name, :title, :role_id, :location,
                       :email, :phone, :linkedin_profile, 0)
                    """
                ),
                {
                    **draft.model_dump(exclude={"role"}),
                    "lead_id": lead_id,
                    "company_id": company_id,
                    "role_id": role_id,
                    "linkedin_profile": draft.linkedin_profile,
                },
            )
            contact_id = int(result.lastrowid)
            self._recalculate_lead_score(conn, lead_id)

        self.audit.mutation(
            tool="add_contact",
            entity="contact",
            entity_id=contact_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"lead_id": lead_id},
        )
        return self.queries.get_record("contacts", contact_id)

    def update_contact(
        self,
        lead_id: RecordReference,
        contact_id: RecordReference,
        changes: ContactUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "name": "ContactName",
            "title": "ContactTitle",
            "location": "ContactLocation",
            "email": "ContactEmail",
            "phone": "ContactPhone",
            "linkedin_profile": "LinkedInProfile",
            "linkedin_request_sent": "LinkedInRequestSent",
            "linkedin_request_accepted": "LinkedInRequestAccepted",
            "email_sent": "EmailSent",
        }
        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            resolved_contact_id = self._resolve_contact_reference(
                conn, contact_id, resolved_lead_id
            )
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            if "role" in raw:
                assignments["ContactRoleId"] = (
                    None
                    if raw["role"] is None
                    else self._resolve_lookup(conn, "contact_roles", raw["role"])
                )
            if not assignments:
                raise ValidationError("No updateable contact fields were supplied")
            params: dict[str, Any] = {
                "contact_id": resolved_contact_id,
                "lead_id": resolved_lead_id,
            }
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = int(value) if isinstance(value, bool) else value
            conn.execute(
                text(
                    f"UPDATE LeadContacts SET {', '.join(set_parts)} "
                    "WHERE LeadContactID = :contact_id AND LeadId = :lead_id"
                ),
                params,
            )
            self._recalculate_lead_score(conn, resolved_lead_id)

        self.audit.mutation(
            tool="update_contact",
            entity="contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={"lead_id": resolved_lead_id, "changed_fields": sorted(raw)},
        )
        return self.queries.get_record("contacts", resolved_contact_id)

    def delete_contact(
        self,
        lead_id: RecordReference,
        contact_id: RecordReference,
    ) -> dict:
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            resolved_contact_id = self._resolve_contact_reference(
                conn, contact_id, resolved_lead_id
            )
            conn.execute(
                text(
                    "UPDATE LeadActivities SET ContactId = NULL "
                    "WHERE LeadId = :lead_id AND ContactId = :contact_id"
                ),
                {"lead_id": resolved_lead_id, "contact_id": resolved_contact_id},
            )
            conn.execute(
                text(
                    "DELETE FROM LeadContacts "
                    "WHERE LeadId = :lead_id AND LeadContactID = :contact_id"
                ),
                {"lead_id": resolved_lead_id, "contact_id": resolved_contact_id},
            )
            self._recalculate_lead_score(conn, resolved_lead_id)
        self.audit.mutation(
            tool="delete_contact",
            entity="contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="deleted",
            metadata={"lead_id": resolved_lead_id},
        )
        return {
            "status": "ok",
            "message": "Lead contact was deleted",
            "contact_id": resolved_contact_id,
        }

    def add_activity(self, draft: ActivityDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("activity", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        actor_id = actor.user_id
        with self.database.transaction() as conn:
            lead_id = self._resolve_lead_reference(conn, draft.lead_id, actor)
            status_id = self._resolve_lookup(conn, "lead_statuses", draft.status)  # type: ignore[arg-type]
            contact_id = (
                self._resolve_contact_reference(conn, draft.contact_id, lead_id)
                if draft.contact_id is not None
                else None
            )
            result = conn.execute(
                text(
                    """
                    INSERT INTO LeadActivities
                      (LeadId, CompanyId, ActivityType, ActivitySubject, ActivityDate, StatusId,
                       Notes, CreatedBy, ContactId)
                    VALUES
                      (:lead_id, :company_id, :activity_type, :subject, :activity_date, :status_id,
                       :notes, :created_by, :contact_id)
                    """
                ),
                {
                    "lead_id": lead_id,
                    "company_id": self._require_company_id(conn, actor),
                    "activity_type": draft.activity_type,
                    "subject": draft.subject,
                    "activity_date": draft.activity_date or datetime.now(UTC),
                    "status_id": status_id,
                    "notes": draft.notes,
                    "created_by": actor_id,
                    "contact_id": contact_id,
                },
            )
            activity_id = int(result.lastrowid)
            conn.execute(
                text(
                    "UPDATE Leads SET StatusId = :status_id, ModifiedOn = NOW(6) "
                    "WHERE LeadId = :lead_id"
                ),
                {"status_id": status_id, "lead_id": lead_id},
            )
            self._recalculate_lead_score(conn, lead_id)

        self.audit.mutation(
            tool="add_activity",
            entity="activity",
            entity_id=activity_id,
            actor_user_id=actor_id,
            outcome="created",
            metadata={"lead_id": lead_id},
        )
        return self.queries.get_record("activities", activity_id)

    def update_activity(self, activity_id: int, changes: ActivityUpdate) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "activity_type": "ActivityType",
            "subject": "ActivitySubject",
            "notes": "Notes",
            "activity_date": "ActivityDate",
        }
        with self.database.transaction() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT a.LeadId, a.CreatedBy, l.OwnerId FROM LeadActivities a "
                        "INNER JOIN Leads l ON l.LeadId = a.LeadId "
                        "WHERE a.ActivityId = :activity_id AND COALESCE(l.IsDeleted, 0) = 0 LIMIT 1"
                    ),
                    {"activity_id": activity_id},
                )
                .mappings()
                .first()
            )
            if row is None:
                raise NotFoundError(f"Activity {activity_id} was not found")
            if not actor.is_manager and actor.user_id not in {
                int(row["OwnerId"] or 0),
                int(row["CreatedBy"] or 0),
            }:
                raise AccessDeniedError(f"You do not have access to activity {activity_id}")
            lead_id = int(row["LeadId"])
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            if "status" in raw:
                assignments["StatusId"] = (
                    None
                    if raw["status"] is None
                    else self._resolve_lookup(conn, "lead_statuses", raw["status"])
                )
            if "contact_id" in raw:
                assignments["ContactId"] = (
                    None
                    if raw["contact_id"] is None
                    else self._resolve_contact_reference(conn, raw["contact_id"], lead_id)
                )
            if not assignments:
                raise ValidationError("No updateable activity fields were supplied")
            params: dict[str, Any] = {"activity_id": activity_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = value
            conn.execute(
                text(
                    f"UPDATE LeadActivities SET {', '.join(set_parts)} "
                    "WHERE ActivityId = :activity_id"
                ),
                params,
            )
            self._recalculate_lead_score(conn, lead_id)

        self.audit.mutation(
            tool="update_activity",
            entity="activity",
            entity_id=activity_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={"lead_id": lead_id, "changed_fields": sorted(raw)},
        )
        return self.queries.get_record("activities", activity_id)

    def schedule_reminder(self, draft: ReminderDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("reminder", missing, draft.model_dump(mode="json"))

        reminder_date = draft.reminder_date
        if reminder_date.tzinfo is None:
            reminder_date = reminder_date.replace(tzinfo=ZoneInfo(self.settings.input_timezone))
        reminder_date_utc = reminder_date.astimezone(UTC).replace(tzinfo=None)
        actor = self._actor()
        actor_id = actor.user_id

        with self.database.transaction() as conn:
            lead_id = self._resolve_lead_reference(conn, draft.lead_id, actor)
            result = conn.execute(
                text(
                    """
                    INSERT INTO LeadReminders
                      (LeadId, CompanyId, ReminderDate, ReminderNote, IsCompleted,
                       NotificationChannels, CreatedBy, Status)
                    VALUES
                      (:lead_id, :company_id, :reminder_date, :note, 0,
                       :notification_channels, :created_by, :status)
                    """
                ),
                {
                    "lead_id": lead_id,
                    "company_id": self._require_company_id(conn, actor),
                    "reminder_date": reminder_date_utc,
                    "note": draft.note,
                    "notification_channels": draft.notification_channels,
                    "created_by": actor_id,
                    "status": draft.status,
                },
            )
            reminder_id = int(result.lastrowid)

        self.audit.mutation(
            tool="schedule_reminder",
            entity="reminder",
            entity_id=reminder_id,
            actor_user_id=actor_id,
            outcome="created",
            metadata={"lead_id": lead_id},
        )
        return self.queries.get_record("reminders", reminder_id)

    def update_reminder(self, reminder_id: int, changes: ReminderUpdate) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        with self.database.transaction() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT r.LeadId, r.CreatedBy, l.OwnerId FROM LeadReminders r "
                        "INNER JOIN Leads l ON l.LeadId = r.LeadId "
                        "WHERE r.ReminderId = :reminder_id AND COALESCE(l.IsDeleted, 0) = 0 LIMIT 1"
                    ),
                    {"reminder_id": reminder_id},
                )
                .mappings()
                .first()
            )
            if row is None:
                raise NotFoundError(f"Reminder {reminder_id} was not found")
            if not actor.is_manager and actor.user_id not in {
                int(row["OwnerId"] or 0),
                int(row["CreatedBy"] or 0),
            }:
                raise AccessDeniedError(f"You do not have access to reminder {reminder_id}")
            assignments: dict[str, Any] = {}
            if "reminder_date" in raw:
                reminder_date = raw["reminder_date"]
                if reminder_date is not None:
                    if reminder_date.tzinfo is None:
                        reminder_date = reminder_date.replace(
                            tzinfo=ZoneInfo(self.settings.input_timezone)
                        )
                    reminder_date = reminder_date.astimezone(UTC).replace(tzinfo=None)
                assignments["ReminderDate"] = reminder_date
            direct_columns = {
                "note": "ReminderNote",
                "status": "Status",
                "notification_channels": "NotificationChannels",
                "is_completed": "IsCompleted",
            }
            for field, column in direct_columns.items():
                if field in raw:
                    assignments[column] = raw[field]
            if "status" in raw and "is_completed" not in raw and raw["status"]:
                assignments["IsCompleted"] = str(raw["status"]).casefold() in {
                    "completed",
                    "done",
                    "cancelled",
                }
            params: dict[str, Any] = {"reminder_id": reminder_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = int(value) if isinstance(value, bool) else value
            conn.execute(
                text(
                    f"UPDATE LeadReminders SET {', '.join(set_parts)} "
                    "WHERE ReminderId = :reminder_id"
                ),
                params,
            )

        self.audit.mutation(
            tool="update_reminder",
            entity="reminder",
            entity_id=reminder_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={"changed_fields": sorted(raw)},
        )
        return self.queries.get_record("reminders", reminder_id)

    def convert_lead(self, lead_id: RecordReference, target: str | None = None) -> dict:
        transitions = {
            "Lead": {"Prospect", "Account"},
            "Prospect": {"Lead", "Account"},
            "Account": {"Master Account"},
            "Master Account": set(),
        }
        defaults = {"Lead": "Prospect", "Prospect": "Account", "Account": "Master Account"}

        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            row = (
                conn.execute(
                    text(
                        """
                    SELECT COALESCE(at.Name, 'Lead') AS current_type
                    FROM Leads l
                    LEFT JOIN AccountTypes at ON at.AccountTypeId = l.AccountTypeId
                    WHERE l.LeadId = :lead_id AND COALESCE(l.IsDeleted, 0) = 0
                    LIMIT 1
                    """
                    ),
                    {"lead_id": resolved_lead_id},
                )
                .mappings()
                .first()
            )
            if row is None:
                raise NotFoundError(f"Lead {lead_id} was not found")
            current = str(row["current_type"])
            requested = target or defaults.get(current)
            if not requested:
                raise ConflictError(f"No further conversion is available from {current}")

            normalized_target = requested.strip()
            allowed = transitions.get(current, set())
            case_map = {item.lower(): item for item in allowed}
            canonical_target = case_map.get(normalized_target.lower())
            if canonical_target is None:
                raise ConflictError(
                    f"Cannot convert {current} to {requested}",
                    details={"allowed_targets": sorted(allowed)},
                )
            target_id = self._resolve_lookup(conn, "account_types", canonical_target)
            conn.execute(
                text(
                    "UPDATE Leads SET AccountTypeId = :target_id, ModifiedOn = NOW(6) "
                    "WHERE LeadId = :lead_id"
                ),
                {"target_id": target_id, "lead_id": resolved_lead_id},
            )

        self.audit.mutation(
            tool="convert_lead",
            entity="lead",
            entity_id=resolved_lead_id,
            actor_user_id=actor.user_id,
            outcome="converted",
            metadata={"from": current, "to": canonical_target},
        )
        return {
            "status": "ok",
            "message": "Lead converted successfully",
            "lead_id": resolved_lead_id,
            "from": current,
            "to": canonical_target,
            "record": self.queries.get_record("leads", resolved_lead_id)["record"],
        }

    def delete_lead(self, lead_id: RecordReference) -> dict:
        """Soft-delete a lead and hide its dependent records from governed queries."""
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_lead_id = self._resolve_lead_reference(conn, lead_id, actor)
            conn.execute(
                text("UPDATE Leads SET IsDeleted = 1, ModifiedOn = NOW(6) WHERE LeadId = :lead_id"),
                {"lead_id": resolved_lead_id},
            )
            conn.execute(text("DELETE FROM LeadScores WHERE LeadId = :lead_id"), {"lead_id": resolved_lead_id})
        self.audit.mutation(
            tool="delete_lead",
            entity="lead",
            entity_id=resolved_lead_id,
            actor_user_id=actor.user_id,
            outcome="soft_deleted",
        )
        return {
            "status": "ok",
            "message": "CRM record was deleted",
            "lead_id": resolved_lead_id,
            "deletion_mode": "soft_delete",
        }

    def create_opportunity(self, draft: OpportunityDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("opportunity", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        with self.database.transaction() as conn:
            lead_id = self._resolve_lead_reference(conn, draft.lead_id, actor)
            project_id = (
                self._resolve_project_reference(conn, draft.project_id, actor)
                if draft.project_id is not None
                else None
            )
            if project_id:
                self._ensure_exists(
                    conn,
                    table="Projects",
                    id_column="ProjectId",
                    record_id=project_id,
                    label="Project",
                    extra_sql="AND CustomerId = :customer_id AND COALESCE(IsDeleted, 0) = 0",
                    extra_params={"customer_id": lead_id},
                )

            service_id = self._resolve_lookup(conn, "services", draft.service)  # type: ignore[arg-type]
            probability_id = self._resolve_lookup(conn, "probabilities", draft.probability)  # type: ignore[arg-type]
            engagement_id = self._resolve_lookup(conn, "engagement_models", draft.engagement_model)  # type: ignore[arg-type]
            status_id = self._resolve_lookup(conn, "opportunity_statuses", draft.status)  # type: ignore[arg-type]

            result = conn.execute(
                text(
                    """
                    INSERT INTO Opportunities
                      (LeadId, CompanyId, ProjectId, ProbabilityId, ServiceId, EngagementId,
                       Opportunity_StatusId, IsDeleted, IsCompleted)
                    VALUES
                      (:lead_id, :company_id, :project_id, :probability_id, :service_id, :engagement_id,
                       :status_id, 0, :is_completed)
                    """
                ),
                {
                    "lead_id": lead_id,
                    "company_id": self._require_company_id(conn, actor),
                    "project_id": project_id,
                    "probability_id": probability_id,
                    "service_id": service_id,
                    "engagement_id": engagement_id,
                    "status_id": status_id,
                    "is_completed": int(draft.is_completed),
                },
            )
            opportunity_id = int(result.lastrowid)
            technology_ids = {
                self._resolve_lookup(conn, "technologies", technology)
                for technology in draft.technologies
            }
            for technology_id in technology_ids:
                conn.execute(
                    text(
                        "INSERT INTO Opportunity_categories (OpportunityId, CompanyId, SubCategoryId) "
                        "VALUES (:opportunity_id, :company_id, :technology_id)"
                    ),
                    {
                        "opportunity_id": opportunity_id,
                        "company_id": self._require_company_id(conn, actor),
                        "technology_id": technology_id,
                    },
                )

        self.audit.mutation(
            tool="create_opportunity",
            entity="opportunity",
            entity_id=opportunity_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"lead_id": lead_id, "technology_count": len(technology_ids)},
        )
        return self.queries.get_record("opportunities", opportunity_id)

    def update_opportunity(
        self,
        opportunity_id: RecordReference,
        changes: OpportunityUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        with self.database.transaction() as conn:
            resolved_opportunity_id = self._resolve_opportunity_reference(
                conn, opportunity_id, actor
            )
            row = (
                conn.execute(
                    text(
                        "SELECT LeadId FROM Opportunities "
                        "WHERE OpportunityId = :opportunity_id AND COALESCE(IsDeleted, 0) = 0"
                    ),
                    {"opportunity_id": resolved_opportunity_id},
                )
                .mappings()
                .first()
            )
            if row is None:
                raise NotFoundError(f"Opportunity {resolved_opportunity_id} was not found")
            lead_id = int(row["LeadId"])
            assignments: dict[str, Any] = {}
            lookup_columns = {
                "service": ("ServiceId", "services"),
                "probability": ("ProbabilityId", "probabilities"),
                "engagement_model": ("EngagementId", "engagement_models"),
                "status": ("Opportunity_StatusId", "opportunity_statuses"),
            }
            for field, (column, lookup) in lookup_columns.items():
                if field in raw:
                    assignments[column] = (
                        None
                        if raw[field] is None
                        else self._resolve_lookup(conn, lookup, raw[field])
                    )
            if "project_id" in raw:
                project_id = (
                    None
                    if raw["project_id"] is None
                    else self._resolve_project_reference(conn, raw["project_id"], actor)
                )
                if project_id is not None:
                    self._ensure_exists(
                        conn,
                        table="Projects",
                        id_column="ProjectId",
                        record_id=project_id,
                        label="Project",
                        extra_sql=("AND CustomerId = :customer_id AND COALESCE(IsDeleted, 0) = 0"),
                        extra_params={"customer_id": lead_id},
                    )
                assignments["ProjectId"] = project_id
            if "is_completed" in raw:
                assignments["IsCompleted"] = raw["is_completed"]

            if assignments:
                params: dict[str, Any] = {"opportunity_id": resolved_opportunity_id}
                set_parts = []
                for index, (column, value) in enumerate(assignments.items()):
                    key = f"value_{index}"
                    set_parts.append(f"{column} = :{key}")
                    params[key] = int(value) if isinstance(value, bool) else value
                set_parts.append("ModifiedOn = NOW(6)")
                conn.execute(
                    text(
                        f"UPDATE Opportunities SET {', '.join(set_parts)} "
                        "WHERE OpportunityId = :opportunity_id"
                    ),
                    params,
                )

            if "technologies" in raw:
                conn.execute(
                    text(
                        "DELETE FROM Opportunity_categories WHERE OpportunityId = :opportunity_id"
                    ),
                    {"opportunity_id": resolved_opportunity_id},
                )
                technology_ids = {
                    self._resolve_lookup(conn, "technologies", technology)
                    for technology in (raw["technologies"] or [])
                }
                for technology_id in technology_ids:
                    conn.execute(
                        text(
                            "INSERT INTO Opportunity_categories (OpportunityId, CompanyId, SubCategoryId) "
                            "VALUES (:opportunity_id, :company_id, :technology_id)"
                        ),
                        {
                            "opportunity_id": resolved_opportunity_id,
                            "technology_id": technology_id,
                        },
                    )

        self.audit.mutation(
            tool="update_opportunity",
            entity="opportunity",
            entity_id=resolved_opportunity_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={"changed_fields": sorted(raw)},
        )
        return self.queries.get_record("opportunities", resolved_opportunity_id)

    def create_project(self, draft: ProjectDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("project", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        with self.database.transaction() as conn:
            customer_id = self._resolve_lead_reference(
                conn, draft.customer_id, actor, label="Customer"
            )
            result = conn.execute(
                text(
                    """
                    INSERT INTO Projects
                      (ProjectCode, ProjectName, ProjectDesc, KeyWork, ValueAdded,
                       Deliverables, Challenges, Notes, StartDate, EndDate, CustomerId, CompanyId,
                       TechStack, IsHidden, IsDeleted)
                    VALUES
                      (:code, :name, :description, :key_work, :value_added,
                       :deliverables, :challenges, :notes, :start_date, :end_date, :customer_id, :company_id,
                       :tech_stack, 0, 0)
                    """
                ),
                {
                    **draft.model_dump(),
                    "customer_id": customer_id,
                    "company_id": self._require_company_id(conn, actor),
                },
            )
            project_id = int(result.lastrowid)

        self.audit.mutation(
            tool="create_project",
            entity="project",
            entity_id=project_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"customer_id": customer_id},
        )
        return self.queries.get_record("projects", project_id)

    def update_project(
        self,
        project_id: RecordReference,
        changes: ProjectUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "name": "ProjectName",
            "code": "ProjectCode",
            "description": "ProjectDesc",
            "tech_stack": "TechStack",
            "key_work": "KeyWork",
            "value_added": "ValueAdded",
            "deliverables": "Deliverables",
            "challenges": "Challenges",
            "notes": "Notes",
            "start_date": "StartDate",
            "end_date": "EndDate",
            "is_hidden": "IsHidden",
        }
        with self.database.transaction() as conn:
            resolved_project_id = self._resolve_project_reference(conn, project_id, actor)
            date_row = (
                conn.execute(
                    text("SELECT StartDate, EndDate FROM Projects WHERE ProjectId = :project_id"),
                    {"project_id": resolved_project_id},
                )
                .mappings()
                .first()
            )
            effective_start = raw.get("start_date", date_row["StartDate"] if date_row else None)
            effective_end = raw.get("end_date", date_row["EndDate"] if date_row else None)
            if effective_start and effective_end and effective_end < effective_start:
                raise ValidationError("end_date cannot be before start_date")
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            params: dict[str, Any] = {"project_id": resolved_project_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = int(value) if isinstance(value, bool) else value
            conn.execute(
                text(f"UPDATE Projects SET {', '.join(set_parts)} WHERE ProjectId = :project_id"),
                params,
            )

        self.audit.mutation(
            tool="update_project",
            entity="project",
            entity_id=resolved_project_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={"changed_fields": sorted(raw)},
        )
        return self.queries.get_record("projects", resolved_project_id)

    def add_opportunity_contact(self, draft: OpportunityContactDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("opportunity_contact", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        with self.database.transaction() as conn:
            opportunity_id = self._resolve_opportunity_reference(conn, draft.opportunity_id, actor)
            company_id = self._require_company_id(conn, actor)
            result = conn.execute(
                text(
                    """
                    INSERT INTO OpportunityContacts
                      (OpportunityId, CompanyId, FullName, FirstName, LastName, PreferredName,
                       JobTitle, Department, SeniorityLevel, CompanyName, WorkEmail,
                       PersonalEmail, DirectPhone, MobilePhone, OfficePhone,
                       LinkedInProfileUrl, IsDeleted)
                    VALUES
                      (:opportunity_id, :company_id, :full_name, :first_name, :last_name, :preferred_name,
                       :job_title, :department, :seniority_level, :company_name, :work_email,
                       :personal_email, :direct_phone, :mobile_phone, :office_phone,
                       :linkedin_profile, 0)
                    """
                ),
                {**draft.model_dump(), "opportunity_id": opportunity_id, "company_id": company_id},
            )
            contact_id = int(result.lastrowid)

        self.audit.mutation(
            tool="add_opportunity_contact",
            entity="opportunity_contact",
            entity_id=contact_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"opportunity_id": opportunity_id},
        )
        return self.queries.get_record("opportunity_contacts", contact_id)

    def update_opportunity_contact(
        self,
        opportunity_id: RecordReference,
        contact_id: RecordReference,
        changes: OpportunityContactUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "full_name": "FullName",
            "first_name": "FirstName",
            "last_name": "LastName",
            "preferred_name": "PreferredName",
            "job_title": "JobTitle",
            "department": "Department",
            "seniority_level": "SeniorityLevel",
            "company_name": "CompanyName",
            "work_email": "WorkEmail",
            "personal_email": "PersonalEmail",
            "direct_phone": "DirectPhone",
            "mobile_phone": "MobilePhone",
            "office_phone": "OfficePhone",
            "linkedin_profile": "LinkedInProfileUrl",
        }
        with self.database.transaction() as conn:
            resolved_opportunity_id = self._resolve_opportunity_reference(
                conn, opportunity_id, actor
            )
            resolved_contact_id = self._resolve_opportunity_contact_reference(
                conn, contact_id, resolved_opportunity_id
            )
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            params: dict[str, Any] = {"contact_id": resolved_contact_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = value
            conn.execute(
                text(
                    f"UPDATE OpportunityContacts SET {', '.join(set_parts)} "
                    "WHERE OpportunityContactId = :contact_id"
                ),
                params,
            )

        self.audit.mutation(
            tool="update_opportunity_contact",
            entity="opportunity_contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={
                "opportunity_id": resolved_opportunity_id,
                "changed_fields": sorted(raw),
            },
        )
        return self.queries.get_record("opportunity_contacts", resolved_contact_id)

    def delete_opportunity_contact(
        self,
        opportunity_id: RecordReference,
        contact_id: RecordReference,
    ) -> dict:
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_opportunity_id = self._resolve_opportunity_reference(
                conn, opportunity_id, actor
            )
            resolved_contact_id = self._resolve_opportunity_contact_reference(
                conn, contact_id, resolved_opportunity_id
            )
            conn.execute(
                text(
                    "UPDATE OpportunityContacts SET IsDeleted = 1 "
                    "WHERE OpportunityContactId = :contact_id"
                ),
                {"contact_id": resolved_contact_id},
            )
        self.audit.mutation(
            tool="delete_opportunity_contact",
            entity="opportunity_contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="soft_deleted",
            metadata={"opportunity_id": resolved_opportunity_id},
        )
        return {
            "status": "ok",
            "message": "Opportunity contact was deleted",
            "contact_id": resolved_contact_id,
            "deletion_mode": "soft_delete",
        }

    def add_project_contact(self, draft: ProjectContactDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("project_contact", missing, draft.model_dump(mode="json"))

        actor = self._actor()
        with self.database.transaction() as conn:
            project_id = self._resolve_project_reference(conn, draft.project_id, actor)
            company_id = self._require_company_id(conn, actor)
            contact_type_id = self._resolve_lookup(conn, "contact_types", draft.contact_type)  # type: ignore[arg-type]
            result = conn.execute(
                text(
                    """
                    INSERT INTO ProjectContacts
                      (ProjectId, CompanyId, ContactName, Title, Email, Phone, ContactTypeId)
                    VALUES
                      (:project_id, :company_id, :name, :title, :email, :phone, :contact_type_id)
                    """
                ),
                {
                    **draft.model_dump(exclude={"contact_type"}),
                    "project_id": project_id,
                    "company_id": company_id,
                    "contact_type_id": contact_type_id,
                },
            )
            contact_id = int(result.lastrowid)

        self.audit.mutation(
            tool="add_project_contact",
            entity="project_contact",
            entity_id=contact_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"project_id": project_id},
        )
        return self.queries.get_record("project_contacts", contact_id)

    def update_project_contact(
        self,
        project_id: RecordReference,
        contact_id: RecordReference,
        changes: ProjectContactUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "name": "ContactName",
            "title": "Title",
            "email": "Email",
            "phone": "Phone",
        }
        with self.database.transaction() as conn:
            resolved_project_id = self._resolve_project_reference(conn, project_id, actor)
            resolved_contact_id = self._resolve_project_contact_reference(
                conn, contact_id, resolved_project_id
            )
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            if "contact_type" in raw:
                assignments["ContactTypeId"] = (
                    None
                    if raw["contact_type"] is None
                    else self._resolve_lookup(conn, "contact_types", raw["contact_type"])
                )
            params: dict[str, Any] = {"contact_id": resolved_contact_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = value
            conn.execute(
                text(
                    f"UPDATE ProjectContacts SET {', '.join(set_parts)} "
                    "WHERE ContactId = :contact_id"
                ),
                params,
            )
        self.audit.mutation(
            tool="update_project_contact",
            entity="project_contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={
                "project_id": resolved_project_id,
                "changed_fields": sorted(raw),
            },
        )
        return self.queries.get_record("project_contacts", resolved_contact_id)

    def delete_project_contact(
        self,
        project_id: RecordReference,
        contact_id: RecordReference,
    ) -> dict:
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_project_id = self._resolve_project_reference(conn, project_id, actor)
            resolved_contact_id = self._resolve_project_contact_reference(
                conn, contact_id, resolved_project_id
            )
            conn.execute(
                text("DELETE FROM ProjectContacts WHERE ContactId = :contact_id"),
                {"contact_id": resolved_contact_id},
            )
        self.audit.mutation(
            tool="delete_project_contact",
            entity="project_contact",
            entity_id=resolved_contact_id,
            actor_user_id=actor.user_id,
            outcome="deleted",
            metadata={"project_id": resolved_project_id},
        )
        return {
            "status": "ok",
            "message": "Project contact was deleted",
            "contact_id": resolved_contact_id,
        }

    def assign_project_resource(self, draft: ProjectResourceDraft) -> dict:
        missing = draft.missing_fields()
        if missing:
            return needs_input("project_resource", missing, draft.model_dump(mode="json"))
        if draft.start_date and draft.end_date and draft.end_date < draft.start_date:
            raise ValidationError("end_date cannot be before start_date")
        if (
            draft.billing_start_date
            and draft.billing_end_date
            and draft.billing_end_date < draft.billing_start_date
        ):
            raise ValidationError("billing_end_date cannot be before billing_start_date")

        actor = self._actor()
        with self.database.transaction() as conn:
            project_id = self._resolve_project_reference(conn, draft.project_id, actor)
            company_id = self._require_company_id(conn, actor)
            result = conn.execute(
                text(
                    """
                    INSERT INTO ProjectResources
                      (ProjectId, CompanyId, EmployeeId, Title, ReportingManager, ReportingManagerTitle,
                       StartDate, EndDate, BillingStartDate, BillingEndDate)
                    VALUES
                      (:project_id, :company_id, :employee_id, :title, :reporting_manager,
                       :reporting_manager_title, :start_date, :end_date,
                       :billing_start_date, :billing_end_date)
                    """
                ),
                {**draft.model_dump(), "project_id": project_id, "company_id": company_id},
            )
            resource_id = int(result.lastrowid)

        self.audit.mutation(
            tool="assign_project_resource",
            entity="project_resource",
            entity_id=resource_id,
            actor_user_id=actor.user_id,
            outcome="created",
            metadata={"project_id": project_id},
        )
        return self.queries.get_record("project_resources", resource_id)

    def update_project_resource(
        self,
        project_id: RecordReference,
        resource_id: RecordReference,
        changes: ProjectResourceUpdate,
    ) -> dict:
        actor = self._actor()
        raw = changes.model_dump(exclude_unset=True)
        direct_columns = {
            "employee_id": "EmployeeId",
            "title": "Title",
            "reporting_manager": "ReportingManager",
            "reporting_manager_title": "ReportingManagerTitle",
            "start_date": "StartDate",
            "end_date": "EndDate",
            "billing_start_date": "BillingStartDate",
            "billing_end_date": "BillingEndDate",
        }
        with self.database.transaction() as conn:
            resolved_project_id = self._resolve_project_reference(conn, project_id, actor)
            resolved_resource_id = self._resolve_project_resource_reference(
                conn, resource_id, resolved_project_id
            )
            row = (
                conn.execute(
                    text(
                        "SELECT StartDate, EndDate, BillingStartDate, BillingEndDate "
                        "FROM ProjectResources WHERE ResourceId = :resource_id"
                    ),
                    {"resource_id": resolved_resource_id},
                )
                .mappings()
                .first()
            )
            effective_start = raw.get("start_date", row["StartDate"] if row else None)
            effective_end = raw.get("end_date", row["EndDate"] if row else None)
            billing_start = raw.get("billing_start_date", row["BillingStartDate"] if row else None)
            billing_end = raw.get("billing_end_date", row["BillingEndDate"] if row else None)
            if effective_start and effective_end and effective_end < effective_start:
                raise ValidationError("end_date cannot be before start_date")
            if billing_start and billing_end and billing_end < billing_start:
                raise ValidationError("billing_end_date cannot be before billing_start_date")
            assignments = {
                column: raw[field] for field, column in direct_columns.items() if field in raw
            }
            params: dict[str, Any] = {"resource_id": resolved_resource_id}
            set_parts = []
            for index, (column, value) in enumerate(assignments.items()):
                key = f"value_{index}"
                set_parts.append(f"{column} = :{key}")
                params[key] = value
            conn.execute(
                text(
                    f"UPDATE ProjectResources SET {', '.join(set_parts)} "
                    "WHERE ResourceId = :resource_id"
                ),
                params,
            )
        self.audit.mutation(
            tool="update_project_resource",
            entity="project_resource",
            entity_id=resolved_resource_id,
            actor_user_id=actor.user_id,
            outcome="updated",
            metadata={
                "project_id": resolved_project_id,
                "changed_fields": sorted(raw),
            },
        )
        return self.queries.get_record("project_resources", resolved_resource_id)

    def delete_project_resource(
        self,
        project_id: RecordReference,
        resource_id: RecordReference,
    ) -> dict:
        actor = self._actor()
        with self.database.transaction() as conn:
            resolved_project_id = self._resolve_project_reference(conn, project_id, actor)
            resolved_resource_id = self._resolve_project_resource_reference(
                conn, resource_id, resolved_project_id
            )
            conn.execute(
                text("DELETE FROM ProjectResources WHERE ResourceId = :resource_id"),
                {"resource_id": resolved_resource_id},
            )
        self.audit.mutation(
            tool="delete_project_resource",
            entity="project_resource",
            entity_id=resolved_resource_id,
            actor_user_id=actor.user_id,
            outcome="deleted",
            metadata={"project_id": resolved_project_id},
        )
        return {
            "status": "ok",
            "message": "Project resource was removed",
            "resource_id": resolved_resource_id,
        }

    def pipeline_summary(self) -> dict:
        actor = self._actor()
        scope_sql = "" if actor.is_manager else " AND l.OwnerId = :scope_user_id"
        params = {} if actor.is_manager else {"scope_user_id": actor.user_id}
        funnel = self.database.fetch_all(
            f"""
            SELECT COALESCE(at.Name, 'Lead') AS account_type, COUNT(*) AS count
            FROM Leads l
            LEFT JOIN AccountTypes at ON at.AccountTypeId = l.AccountTypeId
            WHERE COALESCE(l.IsDeleted, 0) = 0{scope_sql}
            GROUP BY COALESCE(at.Name, 'Lead')
            ORDER BY MIN(COALESCE(at.SortOrder, 10))
            """,
            params,
        )
        by_owner = self.database.fetch_all(
            f"""
            SELECT COALESCE(u.UserName, 'Unassigned') AS owner, COUNT(*) AS count
            FROM Leads l
            LEFT JOIN Users u ON u.UserId = l.OwnerId
            WHERE COALESCE(l.IsDeleted, 0) = 0{scope_sql}
            GROUP BY COALESCE(u.UserName, 'Unassigned')
            ORDER BY count DESC
            """,
            params,
        )
        by_status = self.database.fetch_all(
            f"""
            SELECT COALESCE(s.StatusName, 'New') AS status, COUNT(*) AS count
            FROM Leads l
            LEFT JOIN LeadStatuses s ON s.StatusId = l.StatusId
            WHERE COALESCE(l.IsDeleted, 0) = 0{scope_sql}
            GROUP BY COALESCE(s.StatusName, 'New')
            ORDER BY count DESC
            """,
            params,
        )
        return {
            "status": "ok",
            "scope": "organization" if actor.is_manager else "owned_records",
            "funnel": funnel,
            "by_owner": by_owner,
            "by_status": by_status,
        }
