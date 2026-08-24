from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from acarsh_mcp.errors import ValidationError

FieldKind = Literal["string", "integer", "number", "boolean", "date", "datetime"]


@dataclass(frozen=True, slots=True)
class FieldSpec:
    expression: str
    kind: FieldKind
    description: str
    filterable: bool = True
    sortable: bool = True
    aggregatable: bool = False
    sensitive: bool = False

    def public_dict(self) -> dict:
        return {
            "type": self.kind,
            "description": self.description,
            "filterable": self.filterable,
            "sortable": self.sortable,
            "aggregatable": self.aggregatable,
            "sensitive": self.sensitive,
        }


@dataclass(frozen=True, slots=True)
class EntitySpec:
    name: str
    description: str
    from_clause: str
    primary_key: str
    fields: dict[str, FieldSpec]
    default_fields: tuple[str, ...]
    default_sort: tuple[tuple[str, Literal["asc", "desc"]], ...]
    base_predicates: tuple[str, ...] = field(default_factory=tuple)

    def public_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "primary_key": self.primary_key,
            "default_fields": list(self.default_fields),
            "default_sort": [
                {"field": name, "direction": direction} for name, direction in self.default_sort
            ],
            "fields": {name: spec.public_dict() for name, spec in self.fields.items()},
        }


@dataclass(frozen=True, slots=True)
class RelationshipSpec:
    source_entity: str
    name: str
    target_entity: str
    source_field: str
    target_field: str
    description: str

    def public_dict(self) -> dict:
        return {
            "name": self.name,
            "source_entity": self.source_entity,
            "target_entity": self.target_entity,
            "source_field": self.source_field,
            "target_field": self.target_field,
            "description": self.description,
        }


def _f(
    expression: str,
    kind: FieldKind,
    description: str,
    **kwargs: bool,
) -> FieldSpec:
    return FieldSpec(expression=expression, kind=kind, description=description, **kwargs)


ENTITIES: dict[str, EntitySpec] = {
    "leads": EntitySpec(
        name="leads",
        description="Leads, prospects, accounts and master accounts in the CRM funnel.",
        from_clause="""
            Leads l
            LEFT JOIN Users u ON u.UserId = l.OwnerId
            LEFT JOIN AccountTypes at ON at.AccountTypeId = l.AccountTypeId
            LEFT JOIN LeadStatuses direct_status ON direct_status.StatusId = l.StatusId
        """,
        primary_key="id",
        fields={
            "id": _f("l.LeadId", "integer", "Lead identifier"),
            "company_name": _f("l.CompanyName", "string", "Company or organization name"),
            "company_location": _f("l.CompanyLocation", "string", "Company location"),
            "lead_source": _f("l.LeadSource", "string", "How the lead was sourced"),
            "lead_date": _f("l.LeadDate", "date", "Lead acquisition date"),
            "notes": _f("l.LeadNotes", "string", "Lead notes", sortable=False),
            "owner_id": _f("l.OwnerId", "integer", "Owning ACARSH user id"),
            "owner_name": _f("u.UserName", "string", "Owning user name"),
            "account_type_id": _f("l.AccountTypeId", "integer", "Funnel type id"),
            "account_type": _f(
                "COALESCE(at.Name, 'Lead')", "string", "Lead, Prospect, Account or Master Account"
            ),
            "status_id": _f("l.StatusId", "integer", "Direct lead status id"),
            "status": _f("direct_status.StatusName", "string", "Direct lead status"),
            "created_on": _f("l.CreatedOn", "datetime", "Creation timestamp"),
            "modified_on": _f("l.ModifiedOn", "datetime", "Last modification timestamp"),
            "is_deleted": _f("COALESCE(l.IsDeleted, 0)", "boolean", "Soft-deletion flag"),
            "industry_focus": _f("l.IndustryFocus", "string", "Industry focus"),
            "tags": _f("l.Tags", "string", "Comma-separated lead tags"),
        },
        default_fields=(
            "id",
            "company_name",
            "company_location",
            "account_type",
            "status",
            "owner_name",
            "lead_date",
            "created_on",
        ),
        default_sort=(("created_on", "desc"),),
        base_predicates=("COALESCE(l.IsDeleted, 0) = 0",),
    ),
    "contacts": EntitySpec(
        name="contacts",
        description="Contacts attached to leads, prospects and accounts.",
        from_clause="""
            LeadContacts c
            INNER JOIN Leads l ON l.LeadId = c.LeadId
            LEFT JOIN ContactRoles r ON r.RoleId = c.ContactRoleId
        """,
        primary_key="id",
        fields={
            "id": _f("c.LeadContactID", "integer", "Contact identifier"),
            "lead_id": _f("c.LeadId", "integer", "Parent lead identifier"),
            "company_name": _f("l.CompanyName", "string", "Parent company name"),
            "name": _f("c.ContactName", "string", "Contact full name"),
            "title": _f("c.ContactTitle", "string", "Job title"),
            "role_id": _f("c.ContactRoleId", "integer", "CRM contact role id"),
            "role": _f("r.Role", "string", "CRM contact role"),
            "location": _f("c.ContactLocation", "string", "Contact location"),
            "email": _f("c.ContactEmail", "string", "Contact email", sensitive=True),
            "phone": _f("c.ContactPhone", "string", "Contact phone", sensitive=True),
            "linkedin_profile": _f("c.LinkedInProfile", "string", "LinkedIn profile URL"),
            "linkedin_request_sent": _f(
                "COALESCE(c.LinkedInRequestSent, 0)", "boolean", "LinkedIn request sent"
            ),
            "linkedin_request_accepted": _f(
                "COALESCE(c.LinkedInRequestAccepted, 0)", "boolean", "LinkedIn request accepted"
            ),
            "email_sent": _f("COALESCE(c.EmailSent, 0)", "boolean", "Email outreach sent"),
        },
        default_fields=("id", "lead_id", "company_name", "name", "title", "role", "email", "phone"),
        default_sort=(("id", "desc"),),
        base_predicates=("COALESCE(l.IsDeleted, 0) = 0",),
    ),
    "activities": EntitySpec(
        name="activities",
        description="Sales activities and follow-ups recorded against leads.",
        from_clause="""
            LeadActivities a
            INNER JOIN Leads l ON l.LeadId = a.LeadId
            LEFT JOIN LeadStatuses s ON s.StatusId = a.StatusId
            LEFT JOIN LeadContacts c ON c.LeadContactID = a.ContactId
            LEFT JOIN Users u ON u.UserId = a.CreatedBy
        """,
        primary_key="id",
        fields={
            "id": _f("a.ActivityId", "integer", "Activity identifier"),
            "lead_id": _f("a.LeadId", "integer", "Parent lead identifier"),
            "company_name": _f("l.CompanyName", "string", "Parent company name"),
            "type": _f("a.ActivityType", "string", "Activity mode or type"),
            "subject": _f("a.ActivitySubject", "string", "Activity subject"),
            "date": _f("a.ActivityDate", "datetime", "Activity date and time"),
            "status_id": _f("a.StatusId", "integer", "Resulting status id"),
            "status": _f("s.StatusName", "string", "Resulting lead status"),
            "notes": _f("a.Notes", "string", "Activity notes", sortable=False),
            "contact_id": _f("a.ContactId", "integer", "Related contact id"),
            "contact_name": _f("c.ContactName", "string", "Related contact name"),
            "created_by_id": _f("a.CreatedBy", "integer", "Creator user id"),
            "created_by": _f("u.UserName", "string", "Creator user name"),
            "created_on": _f("a.CreatedOn", "datetime", "Creation timestamp"),
        },
        default_fields=(
            "id",
            "lead_id",
            "company_name",
            "type",
            "date",
            "status",
            "contact_name",
            "created_by",
        ),
        default_sort=(("date", "desc"), ("id", "desc")),
        base_predicates=("COALESCE(l.IsDeleted, 0) = 0",),
    ),
    "reminders": EntitySpec(
        name="reminders",
        description="Scheduled lead reminders and their completion state.",
        from_clause="""
            LeadReminders r
            INNER JOIN Leads l ON l.LeadId = r.LeadId
            LEFT JOIN Users u ON u.UserId = r.CreatedBy
        """,
        primary_key="id",
        fields={
            "id": _f("r.ReminderId", "integer", "Reminder identifier"),
            "lead_id": _f("r.LeadId", "integer", "Parent lead identifier"),
            "company_name": _f("l.CompanyName", "string", "Parent company name"),
            "reminder_date": _f("r.ReminderDate", "datetime", "Reminder date and time"),
            "note": _f("r.ReminderNote", "string", "Reminder note", sortable=False),
            "status": _f("r.Status", "string", "Reminder status"),
            "is_completed": _f("COALESCE(r.IsCompleted, 0)", "boolean", "Completion flag"),
            "notification_channels": _f(
                "r.NotificationChannels", "string", "Notification channels"
            ),
            "created_by_id": _f("r.CreatedBy", "integer", "Creator user id"),
            "created_by": _f("u.UserName", "string", "Creator user name"),
            "created_at": _f("r.CreatedAt", "datetime", "Creation timestamp"),
        },
        default_fields=(
            "id",
            "lead_id",
            "company_name",
            "reminder_date",
            "note",
            "status",
            "is_completed",
            "created_by",
        ),
        default_sort=(("reminder_date", "asc"),),
        base_predicates=("COALESCE(l.IsDeleted, 0) = 0",),
    ),
    "opportunities": EntitySpec(
        name="opportunities",
        description="Sales opportunities linked to a customer and optionally a project.",
        from_clause="""
            Opportunities o
            INNER JOIN Leads l ON l.LeadId = o.LeadId
            LEFT JOIN Projects p ON p.ProjectId = o.ProjectId
            LEFT JOIN Services s ON s.ServiceId = o.ServiceId
            LEFT JOIN Probability pr ON pr.ProbabilityId = o.ProbabilityId
            LEFT JOIN Engagement_Models e ON e.EngagementId = o.EngagementId
            LEFT JOIN Opportunities_Status os ON os.Opportunity_StatusId = o.Opportunity_StatusId
        """,
        primary_key="id",
        fields={
            "id": _f("o.OpportunityId", "integer", "Opportunity identifier"),
            "lead_id": _f("o.LeadId", "integer", "Customer lead/account identifier"),
            "company_name": _f("l.CompanyName", "string", "Customer company name"),
            "project_id": _f("o.ProjectId", "integer", "Related project id"),
            "project_name": _f("p.ProjectName", "string", "Related project name"),
            "service_id": _f("o.ServiceId", "integer", "Service identifier"),
            "service": _f("s.ServiceName", "string", "Service name"),
            "probability_id": _f("o.ProbabilityId", "integer", "Probability identifier"),
            "probability": _f("pr.ProbabilityRange", "string", "Probability range"),
            "engagement_id": _f("o.EngagementId", "integer", "Engagement model identifier"),
            "engagement_model": _f("e.Engagement_ModelName", "string", "Engagement model"),
            "status_id": _f("o.Opportunity_StatusId", "integer", "Opportunity status id"),
            "status": _f("os.Opportunities_StatusName", "string", "Opportunity status"),
            "is_completed": _f("COALESCE(o.IsCompleted, 0)", "boolean", "Completion flag"),
            "created_on": _f("o.CreatedOn", "datetime", "Creation timestamp"),
            "modified_on": _f("o.ModifiedOn", "datetime", "Modification timestamp"),
        },
        default_fields=(
            "id",
            "lead_id",
            "company_name",
            "project_name",
            "service",
            "probability",
            "engagement_model",
            "status",
            "is_completed",
            "created_on",
        ),
        default_sort=(("created_on", "desc"),),
        base_predicates=("COALESCE(o.IsDeleted, 0) = 0", "COALESCE(l.IsDeleted, 0) = 0"),
    ),
    "opportunity_contacts": EntitySpec(
        name="opportunity_contacts",
        description="People associated with sales opportunities.",
        from_clause="""
            OpportunityContacts c
            INNER JOIN Opportunities o ON o.OpportunityId = c.OpportunityId
            INNER JOIN Leads l ON l.LeadId = o.LeadId
        """,
        primary_key="id",
        fields={
            "id": _f("c.OpportunityContactId", "integer", "Opportunity contact id"),
            "opportunity_id": _f("c.OpportunityId", "integer", "Parent opportunity id"),
            "lead_id": _f("o.LeadId", "integer", "Parent lead/account id"),
            "customer": _f("l.CompanyName", "string", "Customer company name"),
            "full_name": _f("c.FullName", "string", "Full name"),
            "job_title": _f("c.JobTitle", "string", "Job title"),
            "department": _f("c.Department", "string", "Department"),
            "company_name": _f("c.CompanyName", "string", "Contact company name"),
            "work_email": _f("c.WorkEmail", "string", "Work email", sensitive=True),
            "mobile_phone": _f("c.MobilePhone", "string", "Mobile phone", sensitive=True),
            "linkedin_profile": _f("c.LinkedInProfileUrl", "string", "LinkedIn profile URL"),
            "created_on": _f("c.CreatedOn", "datetime", "Creation timestamp"),
        },
        default_fields=(
            "id",
            "opportunity_id",
            "customer",
            "full_name",
            "job_title",
            "department",
            "work_email",
            "mobile_phone",
        ),
        default_sort=(("created_on", "desc"),),
        base_predicates=("COALESCE(c.IsDeleted, 0) = 0", "COALESCE(o.IsDeleted, 0) = 0"),
    ),
    "projects": EntitySpec(
        name="projects",
        description="Delivery projects associated with CRM customers.",
        from_clause="""
            Projects p
            LEFT JOIN Leads l ON l.LeadId = p.CustomerId
        """,
        primary_key="id",
        fields={
            "id": _f("p.ProjectId", "integer", "Project identifier"),
            "code": _f("p.ProjectCode", "string", "Project code"),
            "name": _f("p.ProjectName", "string", "Project name"),
            "description": _f("p.ProjectDesc", "string", "Project description", sortable=False),
            "customer_id": _f("p.CustomerId", "integer", "Customer lead/account id"),
            "customer_name": _f("l.CompanyName", "string", "Customer company name"),
            "tech_stack": _f("p.TechStack", "string", "Technology stack"),
            "key_work": _f("p.KeyWork", "string", "Key work", sortable=False),
            "deliverables": _f("p.Deliverables", "string", "Deliverables", sortable=False),
            "start_date": _f("p.StartDate", "date", "Project start date"),
            "end_date": _f("p.EndDate", "date", "Project end date"),
            "is_hidden": _f("COALESCE(p.IsHidden, 0)", "boolean", "Hidden flag"),
        },
        default_fields=(
            "id",
            "code",
            "name",
            "customer_id",
            "customer_name",
            "tech_stack",
            "start_date",
            "end_date",
        ),
        default_sort=(("id", "desc"),),
        base_predicates=("COALESCE(p.IsDeleted, 0) = 0",),
    ),
    "project_contacts": EntitySpec(
        name="project_contacts",
        description="Customer and stakeholder contacts attached to projects.",
        from_clause="""
            ProjectContacts c
            INNER JOIN Projects p ON p.ProjectId = c.ProjectId
            LEFT JOIN Leads l ON l.LeadId = p.CustomerId
            LEFT JOIN ContactType t ON t.ContactTypeId = c.ContactTypeId
        """,
        primary_key="id",
        fields={
            "id": _f("c.ContactId", "integer", "Project contact id"),
            "project_id": _f("c.ProjectId", "integer", "Parent project id"),
            "project_name": _f("p.ProjectName", "string", "Parent project name"),
            "name": _f("c.ContactName", "string", "Contact name"),
            "title": _f("c.Title", "string", "Job title"),
            "email": _f("c.Email", "string", "Email", sensitive=True),
            "phone": _f("c.Phone", "string", "Phone", sensitive=True),
            "contact_type": _f("t.ContactType", "string", "Project contact type"),
        },
        default_fields=(
            "id",
            "project_id",
            "project_name",
            "name",
            "title",
            "email",
            "phone",
            "contact_type",
        ),
        default_sort=(("id", "desc"),),
        base_predicates=("COALESCE(p.IsDeleted, 0) = 0",),
    ),
    "project_resources": EntitySpec(
        name="project_resources",
        description="Employee assignments and billing dates for projects.",
        from_clause="""
            ProjectResources r
            INNER JOIN Projects p ON p.ProjectId = r.ProjectId
            LEFT JOIN Leads l ON l.LeadId = p.CustomerId
        """,
        primary_key="id",
        fields={
            "id": _f("r.ResourceId", "integer", "Resource assignment id"),
            "project_id": _f("r.ProjectId", "integer", "Parent project id"),
            "project_name": _f("p.ProjectName", "string", "Parent project name"),
            "employee_id": _f("r.EmployeeId", "string", "Employee code or id"),
            "title": _f("r.Title", "string", "Project title"),
            "reporting_manager": _f("r.ReportingManager", "string", "Reporting manager"),
            "start_date": _f("r.StartDate", "date", "Assignment start date"),
            "end_date": _f("r.EndDate", "date", "Assignment end date"),
            "billing_start_date": _f("r.BillingStartDate", "date", "Billing start date"),
            "billing_end_date": _f("r.BillingEndDate", "date", "Billing end date"),
        },
        default_fields=(
            "id",
            "project_id",
            "project_name",
            "employee_id",
            "title",
            "reporting_manager",
            "start_date",
            "end_date",
        ),
        default_sort=(("id", "desc"),),
        base_predicates=("COALESCE(p.IsDeleted, 0) = 0",),
    ),
    "users": EntitySpec(
        name="users",
        description="ACARSH users available for ownership and reporting.",
        from_clause="Users u LEFT JOIN Roles r ON r.RoleId = u.RoleId",
        primary_key="id",
        fields={
            "id": _f("u.UserId", "integer", "User identifier"),
            "name": _f("u.UserName", "string", "User name"),
            "role_id": _f("u.RoleId", "integer", "Role identifier"),
            "role": _f("r.RoleName", "string", "Role name"),
            "manager_id": _f("u.mgr_id", "integer", "Manager user id"),
            "is_active": _f("COALESCE(u.IsActive, 1)", "boolean", "Active flag"),
        },
        default_fields=("id", "name", "role", "manager_id", "is_active"),
        default_sort=(("name", "asc"),),
    ),
}


def _relationship(
    source: str,
    name: str,
    target: str,
    source_field: str,
    target_field: str,
    description: str,
) -> RelationshipSpec:
    return RelationshipSpec(
        source_entity=source,
        name=name,
        target_entity=target,
        source_field=source_field,
        target_field=target_field,
        description=description,
    )


RELATIONSHIPS: dict[tuple[str, str], RelationshipSpec] = {
    ("leads", "contacts"): _relationship(
        "leads", "contacts", "contacts", "id", "lead_id", "Contacts attached to a lead"
    ),
    ("leads", "activities"): _relationship(
        "leads",
        "activities",
        "activities",
        "id",
        "lead_id",
        "Activities recorded against a lead",
    ),
    ("leads", "reminders"): _relationship(
        "leads", "reminders", "reminders", "id", "lead_id", "Reminders for a lead"
    ),
    ("leads", "opportunities"): _relationship(
        "leads",
        "opportunities",
        "opportunities",
        "id",
        "lead_id",
        "Opportunities for a lead or account",
    ),
    ("leads", "projects"): _relationship(
        "leads", "projects", "projects", "id", "customer_id", "Projects for a customer"
    ),
    ("contacts", "activities"): _relationship(
        "contacts",
        "activities",
        "activities",
        "id",
        "contact_id",
        "Activities involving a contact",
    ),
    ("opportunities", "contacts"): _relationship(
        "opportunities",
        "contacts",
        "opportunity_contacts",
        "id",
        "opportunity_id",
        "People attached to an opportunity",
    ),
    ("opportunities", "project"): _relationship(
        "opportunities", "project", "projects", "project_id", "id", "Linked project"
    ),
    ("projects", "contacts"): _relationship(
        "projects",
        "contacts",
        "project_contacts",
        "id",
        "project_id",
        "Stakeholders attached to a project",
    ),
    ("projects", "resources"): _relationship(
        "projects",
        "resources",
        "project_resources",
        "id",
        "project_id",
        "Employees and resources assigned to a project",
    ),
    ("projects", "opportunities"): _relationship(
        "projects",
        "opportunities",
        "opportunities",
        "id",
        "project_id",
        "Opportunities linked to a project",
    ),
    ("users", "owned_leads"): _relationship(
        "users", "owned_leads", "leads", "id", "owner_id", "Leads owned by a user"
    ),
    ("users", "created_activities"): _relationship(
        "users",
        "created_activities",
        "activities",
        "id",
        "created_by_id",
        "Activities created by a user",
    ),
    ("users", "created_reminders"): _relationship(
        "users",
        "created_reminders",
        "reminders",
        "id",
        "created_by_id",
        "Reminders created by a user",
    ),
    ("activities", "lead"): _relationship(
        "activities", "lead", "leads", "lead_id", "id", "Lead for an activity"
    ),
    ("activities", "contact"): _relationship(
        "activities", "contact", "contacts", "contact_id", "id", "Contact for an activity"
    ),
    ("reminders", "lead"): _relationship(
        "reminders", "lead", "leads", "lead_id", "id", "Lead for a reminder"
    ),
    ("opportunity_contacts", "opportunity"): _relationship(
        "opportunity_contacts",
        "opportunity",
        "opportunities",
        "opportunity_id",
        "id",
        "Parent opportunity",
    ),
    ("project_contacts", "project"): _relationship(
        "project_contacts", "project", "projects", "project_id", "id", "Parent project"
    ),
    ("project_resources", "project"): _relationship(
        "project_resources", "project", "projects", "project_id", "id", "Parent project"
    ),
}


LOOKUPS: dict[str, tuple[str, str, str]] = {
    "account_types": ("AccountTypes", "AccountTypeId", "Name"),
    "lead_statuses": ("LeadStatuses", "StatusId", "StatusName"),
    "contact_roles": ("ContactRoles", "RoleId", "Role"),
    "opportunity_statuses": (
        "Opportunities_Status",
        "Opportunity_StatusId",
        "Opportunities_StatusName",
    ),
    "services": ("Services", "ServiceId", "ServiceName"),
    "probabilities": ("Probability", "ProbabilityId", "ProbabilityRange"),
    "engagement_models": ("Engagement_Models", "EngagementId", "Engagement_ModelName"),
    "technologies": ("SubCategory", "SubCategoryId", "SubCategoryName"),
    "categories": ("Category", "CategoryId", "CategoryName"),
    "contact_types": ("ContactType", "ContactTypeId", "ContactType"),
}


# Entity aliases mapping common terms to actual entity names
ENTITY_ALIASES = {
    "prospects": "leads",
    "prospect": "leads",
    "accounts": "leads",
    "account": "leads",
    "master_accounts": "leads",
    "master_account": "leads",
}


def get_entity(name: str) -> EntitySpec:
    key = name.strip().lower()
    
    # Check aliases first
    if key in ENTITY_ALIASES:
        key = ENTITY_ALIASES[key]
    
    try:
        entity = ENTITIES[key]
        # If the alias is "prospects", we should add an automatic filter
        # but that's handled at the query level, not here
        return entity
    except KeyError as exc:
        raise ValidationError(
            f"Unknown entity '{name}'.",
            details={"allowed_entities": sorted(ENTITIES)},
        ) from exc


def get_lookup(name: str) -> tuple[str, str, str]:
    key = name.strip().lower()
    try:
        return LOOKUPS[key]
    except KeyError as exc:
        raise ValidationError(
            f"Unknown lookup '{name}'.",
            details={"allowed_lookups": sorted(LOOKUPS)},
        ) from exc


def get_relationship(source_entity: str, name: str) -> RelationshipSpec:
    key = (source_entity.strip().lower(), name.strip().lower())
    try:
        return RELATIONSHIPS[key]
    except KeyError as exc:
        allowed = sorted(
            relationship_name
            for entity_name, relationship_name in RELATIONSHIPS
            if entity_name == key[0]
        )
        raise ValidationError(
            f"Unknown relationship '{name}' for entity '{source_entity}'.",
            details={"allowed_relationships": allowed},
        ) from exc


def public_catalog() -> dict:
    return {
        "entities": {name: spec.public_dict() for name, spec in ENTITIES.items()},
        "lookups": sorted(LOOKUPS),
        "relationships": {
            entity: [
                relationship.public_dict()
                for (source, _), relationship in RELATIONSHIPS.items()
                if source == entity
            ]
            for entity in ENTITIES
        },
    }
