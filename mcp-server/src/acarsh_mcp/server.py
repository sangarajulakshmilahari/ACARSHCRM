from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from sqlalchemy.exc import SQLAlchemyError

from acarsh_mcp import __version__
from acarsh_mcp.access import ActorProvider, CompanyMembership
from acarsh_mcp.catalog import get_entity, public_catalog
from acarsh_mcp.config import get_settings
from acarsh_mcp.crm import CRMService
from acarsh_mcp.db import Database
from acarsh_mcp.errors import MCPDomainError, ValidationError
from acarsh_mcp.models import (
    ActivityDraft,
    ActivityUpdate,
    AggregateRequest,
    ContactDraft,
    ContactUpdate,
    Filter,
    FilterOperator,
    LeadDraft,
    LeadUpdate,
    Metric,
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
    SearchRequest,
    SemanticQueryPlan,
    Sort,
)
from acarsh_mcp.query import QueryCompiler, QueryService
from acarsh_mcp.semantic import SemanticQueryCompiler, SemanticQueryService

logger = logging.getLogger("acarsh_mcp")
settings = get_settings()
database = Database(settings)
compiler = QueryCompiler(settings)


def memberships_for_user(user_id: int) -> list[CompanyMembership]:
    rows = database.fetch_all(
        """
        SELECT CompanyId, RoleId, IsDefault
        FROM CompanyUsers
        WHERE UserId = :user_id
          AND IsActive = 1
        ORDER BY IsDefault DESC, CompanyUserId ASC
        """,
        {"user_id": user_id},
    )
    return [
        CompanyMembership(
            company_id=int(row["CompanyId"]),
            role_id=int(row["RoleId"]),
            is_default=bool(row["IsDefault"]),
        )
        for row in rows
    ]

actors = ActorProvider(settings, memberships_for_user=memberships_for_user)
queries = QueryService(database, compiler, actors)
semantic_compiler = SemanticQueryCompiler(settings)
semantic_queries = SemanticQueryService(database, semantic_compiler, actors)
crm = CRMService(database, queries, settings, actors=actors)

mcp = FastMCP(
    name="ACARSH CRM",
    version=__version__,
    mask_error_details=True,
    strict_input_validation=True,
    instructions="""
    ACARSH CRM provides governed read and write capabilities for leads, prospects,
    accounts, contacts, activities, reminders, opportunities, projects and project
    staffing. Use describe_entity before building a flexible search. Use query_crm for
    multi-entity, relationship, boolean-group, or aggregate questions. Use lookup tools
    before writes when a status, role, service, probability, engagement model or
    technology is ambiguous. Write tools may return status=needs_input; ask the user
    the returned questions and call the same tool again with the completed draft.
    Record references accept ids or unique names. Never invent record references or
    lookup values, and never guess when name resolution reports multiple candidates.
    """.strip(),
)

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(
    readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False
)
DESTRUCTIVE = ToolAnnotations(
    readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False
)

ACTION_CATALOG = {
    "search_records": "Search any supported CRM section with role-scoped filters and sorting.",
    "aggregate_records": "Count and summarize role-scoped CRM records.",
    "query_crm": (
        "Execute a validated semantic query plan with boolean groups, relationships, "
        "related-record counts, and aggregates."
    ),
    "get_company_contacts": "Find accessible contact details by company name.",
    "pipeline_summary": "Explain the accessible lead funnel by type, owner, and status.",
    "calculate_lead_score": "Calculate and store a deterministic lead score (/100) with breakdown.",
    "create_lead": "Create a lead, prospect, or account, optionally with contacts.",
    "update_lead": "Update a lead by id or company name, including string lookup values.",
    "delete_lead": "Soft-delete a lead by id or company name.",
    "convert_lead": "Move a lead through the permitted funnel stages.",
    "add_contact": "Add a contact to a lead identified by id or company name.",
    "update_contact": "Update contact details or outreach flags by contact id or name.",
    "delete_contact": "Delete a lead contact after detaching it from activities.",
    "add_activity": "Record an activity against a lead and optional named contact.",
    "update_activity": "Update an accessible activity by id.",
    "schedule_reminder": "Schedule a timezone-normalized reminder for a lead.",
    "update_reminder": "Reschedule, complete, cancel, or edit a reminder by id.",
    "create_opportunity": "Create an opportunity using names or ids for controlled values.",
    "update_opportunity": "Update an opportunity, project link, technologies, or completion.",
    "create_project": "Create a project for a customer identified by id or company name.",
    "update_project": "Update or hide a project identified by id, code, or name.",
    "add_opportunity_contact": "Add a person to an opportunity.",
    "update_opportunity_contact": "Update a person on an opportunity by id or name.",
    "delete_opportunity_contact": "Soft-delete a person from an opportunity.",
    "add_project_contact": "Add a stakeholder to a project identified by id, code, or name.",
    "update_project_contact": "Update a named stakeholder on a project.",
    "delete_project_contact": "Delete a named stakeholder from a project.",
    "assign_project_resource": "Assign an employee or resource to a project.",
    "update_project_resource": "Update a project assignment by resource id or employee id.",
    "delete_project_resource": "Remove a resource assignment from a project.",
}


def _call(tool_name: str, operation: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return operation()
    except MCPDomainError as exc:
        return exc.as_result()
    except SQLAlchemyError:
        logger.exception("Database operation failed in tool %s", tool_name)
        return {
            "status": "error",
            "error": {
                "code": "database_error",
                "message": "The CRM database operation failed.",
                "details": {"tool": tool_name},
            },
        }
    except Exception:
        logger.exception("Unexpected failure in tool %s", tool_name)
        return {
            "status": "error",
            "error": {
                "code": "internal_error",
                "message": "The MCP tool failed unexpectedly.",
                "details": {"tool": tool_name},
            },
        }


@mcp.tool(tags={"discovery", "read"}, annotations=READ_ONLY)
def list_capabilities() -> dict:
    """List queryable entities, lookup catalogs, and supported CRM write workflows."""
    catalog = public_catalog()
    actor = actors.current(required=False)
    return {
        "status": "ok",
        "query_entities": sorted(catalog["entities"]),
        "lookups": catalog["lookups"],
        "write_workflows": [
            action
            for action in ACTION_CATALOG
            if action
            not in {
                "search_records",
                "aggregate_records",
                "query_crm",
                "get_company_contacts",
                "pipeline_summary",
                "calculate_lead_score",
            }
        ],
        "actions": ACTION_CATALOG,
        "query_guidance": (
            "Use search_records for simple entity filters. Call describe_entity, then "
            "query_crm for relationships, boolean groups, related counts, or grouped metrics."
        ),
        "access": (
            {
                "user_id": actor.user_id,
                "role": actor.role_name,
                "scope": "organization" if actor.is_manager else "owned_or_created_records",
            }
            if actor
            else {"scope": "actor_required_for_data_access"}
        ),
    }


@mcp.tool(tags={"discovery", "read"}, annotations=READ_ONLY)
def explain_capability(action: str | None = None) -> dict:
    """Explain one executable MCP action or return the complete action catalog."""
    if action is None:
        return {
            "status": "ok",
            "actions": ACTION_CATALOG,
            "safety": "All reads and writes are role-scoped; chatbot writes require confirmation.",
        }
    normalized = action.strip().lower()
    if normalized not in ACTION_CATALOG:
        return _call(
            "explain_capability",
            lambda: (_ for _ in ()).throw(
                ValidationError(
                    f"Unknown action '{action}'",
                    details={"allowed_actions": sorted(ACTION_CATALOG)},
                )
            ),
        )
    return {
        "status": "ok",
        "action": normalized,
        "description": ACTION_CATALOG[normalized],
        "role_scoped": True,
        "chatbot_confirmation_required": normalized
        not in {
            "search_records",
            "aggregate_records",
            "get_company_contacts",
            "pipeline_summary",
            "calculate_lead_score",
        },
    }


@mcp.tool(tags={"discovery", "read"}, annotations=READ_ONLY)
def describe_entity(entity: str) -> dict:
    """Describe fields, filterability, sorting and defaults for one queryable entity."""
    return _call(
        "describe_entity",
        lambda: {
            "status": "ok",
            "entity": get_entity(entity).public_dict(),
            "relationships": public_catalog()["relationships"].get(entity.strip().lower(), []),
        },
    )


@mcp.tool(tags={"read", "query"}, annotations=READ_ONLY)
def search_records(
    entity: str,
    filters: list[Filter] | None = None,
    fields: list[str] | None = None,
    sort: list[Sort] | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict:
    """Search an allow-listed CRM entity using structured filters, fields and sorting."""
    return _call(
        "search_records",
        lambda: queries.search(
            SearchRequest(
                entity=entity,
                filters=filters or [],
                fields=fields,
                sort=sort or [],
                limit=limit,
                offset=offset,
            )
        ),
    )


@mcp.tool(tags={"read", "query"}, annotations=READ_ONLY)
def get_record(entity: str, record_id: int) -> dict:
    """Get a complete record by entity name and numeric primary key."""
    return _call("get_record", lambda: queries.get_record(entity, record_id))


@mcp.tool(tags={"read", "contacts", "query"}, annotations=READ_ONLY)
def get_company_contacts(company_name: str, limit: int = 25) -> dict:
    """Get role-scoped names, titles, roles, emails and phones for a company."""
    request = SearchRequest(
        entity="contacts",
        filters=[
            Filter(
                field="company_name",
                operator=FilterOperator.CONTAINS,
                value=company_name,
            )
        ],
        fields=[
            "id",
            "lead_id",
            "company_name",
            "name",
            "title",
            "role",
            "location",
            "email",
            "phone",
            "linkedin_profile",
        ],
        limit=limit,
    )
    return _call("get_company_contacts", lambda: queries.search(request))


@mcp.tool(tags={"read", "analytics"}, annotations=READ_ONLY)
def aggregate_records(
    entity: str,
    filters: list[Filter] | None = None,
    group_by: list[str] | None = None,
    metrics: list[Metric] | None = None,
    sort: list[Sort] | None = None,
    limit: int = 100,
) -> dict:
    """Count or aggregate an entity using safe grouping and structured filters."""
    request_data: dict[str, Any] = {
        "entity": entity,
        "filters": filters or [],
        "group_by": group_by or [],
        "sort": sort or [],
        "limit": limit,
    }
    if metrics is not None:
        request_data["metrics"] = metrics
    return _call(
        "aggregate_records",
        lambda: queries.aggregate(AggregateRequest.model_validate(request_data)),
    )


@mcp.tool(tags={"read", "query", "semantic", "analytics"}, annotations=READ_ONLY)
def query_crm(plan: SemanticQueryPlan) -> dict:
    """Execute a role-scoped semantic query plan; raw SQL is never accepted.

    Use relationship names from describe_entity. Top-level filters, boolean groups,
    and relationship conditions are combined with AND. Date filters accept ISO values
    or tokens such as today, this_month, last_month, this_year, and last_30_days.
    Metric aliases can be used by having and aggregate sort conditions.
    """
    return _call("query_crm", lambda: semantic_queries.execute(plan))


@mcp.tool(tags={"read", "analytics"}, annotations=READ_ONLY)
def pipeline_summary() -> dict:
    """Return role-scoped funnel counts grouped by type, owner and status."""
    return _call("pipeline_summary", crm.pipeline_summary)


@mcp.tool(tags={"read", "analytics", "leads"}, annotations=READ_ONLY)
def calculate_lead_score(lead_id: RecordReference) -> dict:
    """Calculate and persist deterministic lead score for a lead by id or company name."""
    return _call("calculate_lead_score", lambda: crm.calculate_lead_score(lead_id))


@mcp.tool(tags={"read", "lookup"}, annotations=READ_ONLY)
def list_lookup_values(lookup: str) -> dict:
    """List valid ids and names for a controlled CRM lookup catalog."""
    return _call("list_lookup_values", lambda: crm.list_lookup(lookup))


@mcp.tool(tags={"diagnostic", "read"}, annotations=READ_ONLY)
def health() -> dict:
    """Check MCP process and CRM database connectivity."""

    def check() -> dict:
        available = database.ping()
        return {
            "status": "ok" if available else "error",
            "service": "acarsh-mcp",
            "database": "ok" if available else "unavailable",
            "transport": settings.transport,
        }

    return _call("health", check)


@mcp.tool(tags={"write", "leads"}, annotations=WRITE)
def create_lead(draft: LeadDraft) -> dict:
    """Create a lead, prospect or account and optional contacts in one transaction."""
    return _call("create_lead", lambda: crm.create_lead(draft))


@mcp.tool(tags={"write", "leads"}, annotations=WRITE)
def update_lead(lead_id: RecordReference, changes: LeadUpdate) -> dict:
    """Patch a lead, prospect or account by numeric id or company name."""
    return _call("update_lead", lambda: crm.update_lead(lead_id, changes))


@mcp.tool(tags={"write", "leads", "destructive"}, annotations=DESTRUCTIVE)
def delete_lead(lead_id: RecordReference) -> dict:
    """Soft-delete a lead, prospect, or account by numeric id or company name."""
    return _call("delete_lead", lambda: crm.delete_lead(lead_id))


@mcp.tool(tags={"write", "contacts"}, annotations=WRITE)
def add_contact(draft: ContactDraft) -> dict:
    """Add a contact to a lead, prospect or account."""
    return _call("add_contact", lambda: crm.add_contact(draft))


@mcp.tool(tags={"write", "contacts"}, annotations=WRITE)
def update_contact(
    lead_id: RecordReference,
    contact_id: RecordReference,
    changes: ContactUpdate,
) -> dict:
    """Update a lead contact using company/contact names or numeric ids."""
    return _call(
        "update_contact",
        lambda: crm.update_contact(lead_id, contact_id, changes),
    )


@mcp.tool(tags={"write", "contacts", "destructive"}, annotations=DESTRUCTIVE)
def delete_contact(
    lead_id: RecordReference,
    contact_id: RecordReference,
) -> dict:
    """Delete a lead contact by company/contact names or numeric ids."""
    return _call(
        "delete_contact",
        lambda: crm.delete_contact(lead_id, contact_id),
    )


@mcp.tool(tags={"write", "activities"}, annotations=WRITE)
def add_activity(draft: ActivityDraft) -> dict:
    """Record a CRM activity and update the lead's current status."""
    return _call("add_activity", lambda: crm.add_activity(draft))


@mcp.tool(tags={"write", "activities"}, annotations=WRITE)
def update_activity(activity_id: int, changes: ActivityUpdate) -> dict:
    """Update the type, subject, notes, status, date, or contact on an activity."""
    return _call("update_activity", lambda: crm.update_activity(activity_id, changes))


@mcp.tool(tags={"write", "reminders"}, annotations=WRITE)
def schedule_reminder(draft: ReminderDraft) -> dict:
    """Schedule a reminder; timezone-aware values are normalized to UTC."""
    return _call("schedule_reminder", lambda: crm.schedule_reminder(draft))


@mcp.tool(tags={"write", "reminders"}, annotations=WRITE)
def update_reminder(reminder_id: int, changes: ReminderUpdate) -> dict:
    """Reschedule, edit, complete, or cancel an accessible reminder."""
    return _call("update_reminder", lambda: crm.update_reminder(reminder_id, changes))


@mcp.tool(tags={"write", "conversion"}, annotations=WRITE)
def convert_lead(lead_id: RecordReference, target: str | None = None) -> dict:
    """Convert a CRM record by numeric id or company name to another funnel stage."""
    return _call("convert_lead", lambda: crm.convert_lead(lead_id, target))


@mcp.tool(tags={"write", "opportunities"}, annotations=WRITE)
def create_opportunity(draft: OpportunityDraft) -> dict:
    """Create an opportunity with validated service, probability, status and technologies."""
    return _call("create_opportunity", lambda: crm.create_opportunity(draft))


@mcp.tool(tags={"write", "opportunities"}, annotations=WRITE)
def update_opportunity(
    opportunity_id: RecordReference,
    changes: OpportunityUpdate,
) -> dict:
    """Update an opportunity by id or a unique customer/company reference."""
    return _call(
        "update_opportunity",
        lambda: crm.update_opportunity(opportunity_id, changes),
    )


@mcp.tool(tags={"write", "projects"}, annotations=WRITE)
def create_project(draft: ProjectDraft) -> dict:
    """Create a delivery project for a CRM customer."""
    return _call("create_project", lambda: crm.create_project(draft))


@mcp.tool(tags={"write", "projects"}, annotations=WRITE)
def update_project(project_id: RecordReference, changes: ProjectUpdate) -> dict:
    """Update or hide a project by numeric id, code, or name."""
    return _call("update_project", lambda: crm.update_project(project_id, changes))


@mcp.tool(tags={"write", "opportunities", "contacts"}, annotations=WRITE)
def add_opportunity_contact(draft: OpportunityContactDraft) -> dict:
    """Add a person to an existing opportunity."""
    return _call("add_opportunity_contact", lambda: crm.add_opportunity_contact(draft))


@mcp.tool(tags={"write", "opportunities", "contacts"}, annotations=WRITE)
def update_opportunity_contact(
    opportunity_id: RecordReference,
    contact_id: RecordReference,
    changes: OpportunityContactUpdate,
) -> dict:
    """Update an opportunity contact by opportunity and contact id or name."""
    return _call(
        "update_opportunity_contact",
        lambda: crm.update_opportunity_contact(opportunity_id, contact_id, changes),
    )


@mcp.tool(
    tags={"write", "opportunities", "contacts", "destructive"},
    annotations=DESTRUCTIVE,
)
def delete_opportunity_contact(
    opportunity_id: RecordReference,
    contact_id: RecordReference,
) -> dict:
    """Soft-delete an opportunity contact by opportunity and contact id or name."""
    return _call(
        "delete_opportunity_contact",
        lambda: crm.delete_opportunity_contact(opportunity_id, contact_id),
    )


@mcp.tool(tags={"write", "projects", "contacts"}, annotations=WRITE)
def add_project_contact(draft: ProjectContactDraft) -> dict:
    """Add a stakeholder contact to an existing project."""
    return _call("add_project_contact", lambda: crm.add_project_contact(draft))


@mcp.tool(tags={"write", "projects", "contacts"}, annotations=WRITE)
def update_project_contact(
    project_id: RecordReference,
    contact_id: RecordReference,
    changes: ProjectContactUpdate,
) -> dict:
    """Update a project contact by project and contact id or name."""
    return _call(
        "update_project_contact",
        lambda: crm.update_project_contact(project_id, contact_id, changes),
    )


@mcp.tool(
    tags={"write", "projects", "contacts", "destructive"},
    annotations=DESTRUCTIVE,
)
def delete_project_contact(
    project_id: RecordReference,
    contact_id: RecordReference,
) -> dict:
    """Delete a project contact by project and contact id or name."""
    return _call(
        "delete_project_contact",
        lambda: crm.delete_project_contact(project_id, contact_id),
    )


@mcp.tool(tags={"write", "projects", "resources"}, annotations=WRITE)
def assign_project_resource(draft: ProjectResourceDraft) -> dict:
    """Assign an employee/resource and optional billing dates to a project."""
    return _call("assign_project_resource", lambda: crm.assign_project_resource(draft))


@mcp.tool(tags={"write", "projects", "resources"}, annotations=WRITE)
def update_project_resource(
    project_id: RecordReference,
    resource_id: RecordReference,
    changes: ProjectResourceUpdate,
) -> dict:
    """Update a resource assignment by project and resource/employee reference."""
    return _call(
        "update_project_resource",
        lambda: crm.update_project_resource(project_id, resource_id, changes),
    )


@mcp.tool(
    tags={"write", "projects", "resources", "destructive"},
    annotations=DESTRUCTIVE,
)
def delete_project_resource(
    project_id: RecordReference,
    resource_id: RecordReference,
) -> dict:
    """Remove a resource assignment by project and resource/employee reference."""
    return _call(
        "delete_project_resource",
        lambda: crm.delete_project_resource(project_id, resource_id),
    )


@mcp.resource("acarsh://schema/catalog")
def catalog_resource() -> dict:
    """Machine-readable catalog of queryable CRM entities and lookup names."""
    return public_catalog()


@mcp.resource("acarsh://schema/{entity}")
def entity_schema_resource(entity: str) -> dict:
    """Machine-readable schema for one queryable entity."""
    try:
        key = entity.strip().lower()
        schema = get_entity(key).public_dict()
        schema["relationships"] = public_catalog()["relationships"].get(key, [])
        return schema
    except MCPDomainError as exc:
        return exc.as_result()


@mcp.resource("acarsh://lookups/{lookup}")
def lookup_resource(lookup: str) -> dict:
    """Current values for a CRM lookup catalog."""
    return _call("lookup_resource", lambda: crm.list_lookup(lookup))


@mcp.prompt
def crm_assistant() -> str:
    """Instructions for an agent using ACARSH CRM tools."""
    try:
        input_timezone = ZoneInfo(settings.input_timezone)
        timezone_name = settings.input_timezone
    except ZoneInfoNotFoundError:
        input_timezone = ZoneInfo("UTC")
        timezone_name = "UTC"
    current_date = datetime.now(input_timezone).date().isoformat()
    return f"""
You are working with the ACARSH CRM MCP server.

The current application date is {current_date} in the {timezone_name} time zone.
Resolve relative date phrases from this date and generate explicit ISO date filters in
the semantic plan. Normally use an inclusive gte start and exclusive lt end. Do not
interpret a period such as "last three months" as the latest three records.

For reads:
1. Call list_capabilities when the relevant entity is unclear.
2. Call describe_entity before constructing a search or aggregation.
3. Use query_crm for user-defined periods, related records, absence/existence,
   related-record counts, boolean groups, grouped metrics, or HAVING conditions.
4. Use structured filters only; never request or invent raw SQL.
5. Resolve ambiguous names with a search before using record ids.
6. For system-wide reports, execute the necessary role-scoped entity queries and
   synthesize the results only after all relevant sections have been collected.

For writes:
1. Preserve the user's stated values exactly.
2. Use list_lookup_values for controlled fields.
3. If a tool returns status=needs_input, ask the returned questions and retry.
4. Use company, project, contact, opportunity-customer, or owner names directly when
   the tool schema allows a string reference; never invent identifiers.
5. Summarize the committed record and its id after success.
""".strip()


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    run_options: dict[str, Any] = {"transport": settings.transport}
    if settings.transport != "stdio":
        run_options.update(
            {
                "host": settings.host,
                "port": settings.port,
                "path": settings.http_path,
            }
        )
    mcp.run(**run_options)


if __name__ == "__main__":
    main()
