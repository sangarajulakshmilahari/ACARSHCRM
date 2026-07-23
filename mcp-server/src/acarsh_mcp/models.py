from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


def _normalize_record_reference(value: Any) -> int | str:
    if isinstance(value, bool):
        raise ValueError("A record reference must be a positive id or a name")
    if isinstance(value, int):
        if value <= 0:
            raise ValueError("Record ids must be positive")
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            raise ValueError("Record names cannot be blank")
        return normalized
    raise ValueError("A record reference must be a positive id or a name")


RecordReference = Annotated[
    int | str,
    BeforeValidator(_normalize_record_reference),
    Field(description="A numeric record id or an exact/unique record name"),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class FilterOperator(StrEnum):
    EQ = "eq"
    NE = "ne"
    CONTAINS = "contains"
    STARTS_WITH = "starts_with"
    IN = "in"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    BETWEEN = "between"
    IS_NULL = "is_null"


class Filter(StrictModel):
    field: str = Field(description="Catalog field name; raw SQL is not accepted")
    operator: FilterOperator = FilterOperator.EQ
    value: Any = None

    @model_validator(mode="after")
    def validate_operator_value(self) -> Filter:
        if self.operator == FilterOperator.IN:
            if not isinstance(self.value, list) or not self.value:
                raise ValueError("The 'in' operator requires a non-empty list")
            if len(self.value) > 100:
                raise ValueError("The 'in' operator accepts at most 100 values")
        elif self.operator == FilterOperator.BETWEEN:
            if not isinstance(self.value, list) or len(self.value) != 2:
                raise ValueError("The 'between' operator requires exactly two values")
        elif self.operator == FilterOperator.IS_NULL:
            if not isinstance(self.value, bool):
                raise ValueError("The 'is_null' operator requires true or false")
        elif self.value is None:
            raise ValueError(f"The '{self.operator}' operator requires a value")
        return self


class Sort(StrictModel):
    field: str
    direction: Literal["asc", "desc"] = "asc"


class SearchRequest(StrictModel):
    entity: str
    filters: list[Filter] = Field(default_factory=list, max_length=30)
    fields: list[str] | None = Field(default=None, max_length=30)
    sort: list[Sort] = Field(default_factory=list, max_length=5)
    limit: int = Field(default=25, ge=1, le=500)
    offset: int = Field(default=0, ge=0, le=1_000_000)


class AggregateFunction(StrEnum):
    COUNT = "count"
    COUNT_DISTINCT = "count_distinct"
    SUM = "sum"
    AVG = "avg"
    MIN = "min"
    MAX = "max"


class Metric(StrictModel):
    function: AggregateFunction = AggregateFunction.COUNT
    field: str | None = None
    alias: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_]{0,49}$")

    @model_validator(mode="after")
    def require_field_for_non_count(self) -> Metric:
        if self.function != AggregateFunction.COUNT and not self.field:
            raise ValueError(f"Metric '{self.function}' requires a field")
        return self


class AggregateRequest(StrictModel):
    entity: str
    filters: list[Filter] = Field(default_factory=list, max_length=30)
    group_by: list[str] = Field(default_factory=list, max_length=4)
    metrics: list[Metric] = Field(
        default_factory=lambda: [Metric(function=AggregateFunction.COUNT, alias="count")],
        min_length=1,
        max_length=10,
    )
    sort: list[Sort] = Field(default_factory=list, max_length=5)
    limit: int = Field(default=100, ge=1, le=500)


class FilterGroup(StrictModel):
    """One bounded boolean group; groups themselves are combined with AND."""

    match: Literal["all", "any"] = Field(
        default="all",
        description="Whether every filter (all) or at least one filter (any) must match",
    )
    filters: list[Filter] = Field(
        min_length=1,
        max_length=20,
        description="Filters inside this group; top-level groups are combined with AND",
    )


class RelatedCondition(StrictModel):
    """Filter a base entity through an allow-listed catalog relationship."""

    relationship: str = Field(
        description="Allow-listed relationship name returned by describe_entity"
    )
    quantifier: Literal["exists", "not_exists"] = "exists"
    filters: list[Filter] = Field(
        default_factory=list,
        max_length=20,
        description="Filters on the related entity, not the base entity",
    )
    filter_groups: list[FilterGroup] = Field(default_factory=list, max_length=5)
    min_count: int | None = Field(default=None, ge=0, le=10_000)
    max_count: int | None = Field(default=None, ge=0, le=10_000)

    @model_validator(mode="after")
    def validate_counts(self) -> RelatedCondition:
        if self.min_count is not None or self.max_count is not None:
            if self.quantifier != "exists":
                raise ValueError("Count bounds cannot be combined with not_exists")
            if (
                self.min_count is not None
                and self.max_count is not None
                and self.max_count < self.min_count
            ):
                raise ValueError("max_count cannot be below min_count")
        return self


class HavingCondition(StrictModel):
    metric: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,49}$")
    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte"]
    value: float


class SemanticQueryPlan(StrictModel):
    """Safe model-generated plan that MCP compiles to parameterized read-only SQL."""

    entity: str = Field(description="Base entity name returned by list_capabilities")
    fields: list[str] | None = Field(default=None, max_length=30)
    filters: list[Filter] = Field(default_factory=list, max_length=30)
    filter_groups: list[FilterGroup] = Field(
        default_factory=list,
        max_length=8,
        description="Bounded boolean groups, each combined with other conditions using AND",
    )
    related: list[RelatedCondition] = Field(
        default_factory=list,
        max_length=8,
        description="Existence, absence, or count conditions over allow-listed relationships",
    )
    group_by: list[str] = Field(default_factory=list, max_length=6)
    metrics: list[Metric] = Field(default_factory=list, max_length=10)
    having: list[HavingCondition] = Field(
        default_factory=list,
        max_length=10,
        description="Post-aggregation conditions that reference metric aliases",
    )
    sort: list[Sort] = Field(default_factory=list, max_length=6)
    limit: int = Field(default=25, ge=1, le=500)
    offset: int = Field(default=0, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_mode(self) -> SemanticQueryPlan:
        aggregate_mode = bool(self.group_by or self.metrics or self.having)
        if self.having and not self.metrics:
            raise ValueError("having requires metrics")
        if aggregate_mode and not self.metrics:
            self.metrics = [Metric(function=AggregateFunction.COUNT, alias="count")]
        if aggregate_mode and self.fields:
            raise ValueError("Use group_by instead of fields for an aggregate plan")
        return self


class LeadContactDraft(StrictModel):
    name: str | None = None
    title: str | None = None
    role: str | int | None = None
    location: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_profile: str | None = None

    def missing_fields(self, index: int | None = None) -> list[str]:
        prefix = f"contacts[{index}]." if index is not None else ""
        missing = []
        if not self.name:
            missing.append(f"{prefix}name")
        if not self.role:
            missing.append(f"{prefix}role")
        return missing


class LeadDraft(StrictModel):
    company_name: str | None = None
    company_location: str | None = None
    lead_source: str | None = None
    lead_date: date | None = None
    notes: str | None = None
    owner_id: RecordReference | None = Field(
        default=None,
        description="Owner user id or exact/unique user name",
    )
    account_type: str = "Lead"
    status: str | int = "New"
    contacts: list[LeadContactDraft] = Field(default_factory=list, max_length=25)

    def missing_fields(self) -> list[str]:
        missing = []
        if not self.company_name:
            missing.append("company_name")
        for index, contact in enumerate(self.contacts):
            missing.extend(contact.missing_fields(index))
        return missing


class LeadUpdate(StrictModel):
    company_name: str | None = None
    company_location: str | None = None
    lead_source: str | None = None
    lead_date: date | None = None
    notes: str | None = None
    owner_id: RecordReference | None = Field(
        default=None,
        description="Owner user id or exact/unique user name",
    )
    account_type: str | None = None
    status: str | int | None = None
    industry_focus: str | None = None
    tags: str | None = None

    @model_validator(mode="after")
    def require_change(self) -> LeadUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ContactDraft(LeadContactDraft):
    lead_id: RecordReference = Field(description="Lead id or company name")


class ContactUpdate(StrictModel):
    name: str | None = None
    title: str | None = None
    role: str | int | None = None
    location: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_profile: str | None = None
    linkedin_request_sent: bool | None = None
    linkedin_request_accepted: bool | None = None
    email_sent: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> ContactUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ActivityDraft(StrictModel):
    lead_id: RecordReference = Field(description="Lead id or company name")
    activity_type: str | None = None
    subject: str | None = None
    notes: str | None = None
    status: str | int | None = None
    activity_date: datetime | None = None
    contact_id: RecordReference | None = Field(
        default=None,
        description="Contact id or contact name within the selected lead",
    )

    def missing_fields(self) -> list[str]:
        missing = []
        if not self.activity_type:
            missing.append("activity_type")
        if not self.notes:
            missing.append("notes")
        if not self.status:
            missing.append("status")
        return missing


class ActivityUpdate(StrictModel):
    activity_type: str | None = None
    subject: str | None = None
    notes: str | None = None
    status: str | int | None = None
    activity_date: datetime | None = None
    contact_id: RecordReference | None = Field(
        default=None,
        description="Contact id or contact name; set null to remove the contact",
    )

    @model_validator(mode="after")
    def require_change(self) -> ActivityUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ReminderDraft(StrictModel):
    lead_id: RecordReference = Field(description="Lead id or company name")
    reminder_date: datetime | None = None
    note: str | None = None
    status: str = "Pending"
    notification_channels: str = "Email"

    def missing_fields(self) -> list[str]:
        missing = []
        if self.reminder_date is None:
            missing.append("reminder_date")
        if not self.note:
            missing.append("note")
        return missing


class ReminderUpdate(StrictModel):
    reminder_date: datetime | None = None
    note: str | None = None
    status: str | None = None
    notification_channels: str | None = None
    is_completed: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> ReminderUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class OpportunityDraft(StrictModel):
    lead_id: RecordReference = Field(description="Lead id or company name")
    project_id: RecordReference | None = Field(
        default=None,
        description="Project id, code, or name",
    )
    service: str | int | None = None
    probability: str | int | None = None
    engagement_model: str | int | None = None
    status: str | int | None = None
    technologies: list[str | int] = Field(default_factory=list, max_length=50)
    is_completed: bool = False

    def missing_fields(self) -> list[str]:
        return [
            field
            for field, value in (
                ("service", self.service),
                ("probability", self.probability),
                ("engagement_model", self.engagement_model),
                ("status", self.status),
            )
            if value is None or value == ""
        ]


class OpportunityUpdate(StrictModel):
    project_id: RecordReference | None = Field(
        default=None,
        description="Project id, code, or name; set null to unlink the project",
    )
    service: str | int | None = None
    probability: str | int | None = None
    engagement_model: str | int | None = None
    status: str | int | None = None
    technologies: list[str | int] | None = Field(default=None, max_length=50)
    is_completed: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> OpportunityUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ProjectDraft(StrictModel):
    customer_id: RecordReference = Field(description="Customer lead/account id or company name")
    name: str | None = None
    code: str | None = None
    description: str | None = None
    tech_stack: str | None = None
    key_work: str | None = None
    value_added: str | None = None
    deliverables: str | None = None
    challenges: str | None = None
    notes: str | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> ProjectDraft:
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self

    def missing_fields(self) -> list[str]:
        return [] if self.name else ["name"]


class ProjectUpdate(StrictModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    tech_stack: str | None = None
    key_work: str | None = None
    value_added: str | None = None
    deliverables: str | None = None
    challenges: str | None = None
    notes: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_hidden: bool | None = None

    @model_validator(mode="after")
    def validate_update(self) -> ProjectUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class OpportunityContactDraft(StrictModel):
    opportunity_id: RecordReference = Field(
        description="Opportunity id or a unique customer/company reference"
    )
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    preferred_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    seniority_level: str | None = None
    company_name: str | None = None
    work_email: str | None = None
    personal_email: str | None = None
    direct_phone: str | None = None
    mobile_phone: str | None = None
    office_phone: str | None = None
    linkedin_profile: str | None = None

    def missing_fields(self) -> list[str]:
        return [] if self.full_name else ["full_name"]


class OpportunityContactUpdate(StrictModel):
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    preferred_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    seniority_level: str | None = None
    company_name: str | None = None
    work_email: str | None = None
    personal_email: str | None = None
    direct_phone: str | None = None
    mobile_phone: str | None = None
    office_phone: str | None = None
    linkedin_profile: str | None = None

    @model_validator(mode="after")
    def require_change(self) -> OpportunityContactUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ProjectContactDraft(StrictModel):
    project_id: RecordReference = Field(description="Project id, code, or name")
    name: str | None = None
    contact_type: str | int | None = None
    title: str | None = None
    email: str | None = None
    phone: str | None = None

    def missing_fields(self) -> list[str]:
        missing = []
        if not self.name:
            missing.append("name")
        if not self.contact_type:
            missing.append("contact_type")
        return missing


class ProjectContactUpdate(StrictModel):
    name: str | None = None
    contact_type: str | int | None = None
    title: str | None = None
    email: str | None = None
    phone: str | None = None

    @model_validator(mode="after")
    def require_change(self) -> ProjectContactUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        return self


class ProjectResourceDraft(StrictModel):
    project_id: RecordReference = Field(description="Project id, code, or name")
    employee_id: str | None = None
    title: str | None = None
    reporting_manager: str | None = None
    reporting_manager_title: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    billing_start_date: date | None = None
    billing_end_date: date | None = None

    @field_validator("employee_id")
    @classmethod
    def normalize_employee_id(cls, value: str | None) -> str | None:
        return value.strip() if value else None

    def missing_fields(self) -> list[str]:
        return [] if self.employee_id else ["employee_id"]


class ProjectResourceUpdate(StrictModel):
    employee_id: str | None = None
    title: str | None = None
    reporting_manager: str | None = None
    reporting_manager_title: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    billing_start_date: date | None = None
    billing_end_date: date | None = None

    @model_validator(mode="after")
    def validate_update(self) -> ProjectResourceUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        if (
            self.billing_start_date
            and self.billing_end_date
            and self.billing_end_date < self.billing_start_date
        ):
            raise ValueError("billing_end_date cannot be before billing_start_date")
        return self
