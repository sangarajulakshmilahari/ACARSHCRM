from datetime import date

import pytest
from pydantic import ValidationError

from acarsh_mcp.models import (
    ActivityDraft,
    ContactDraft,
    Filter,
    FilterOperator,
    LeadContactDraft,
    LeadDraft,
    ProjectDraft,
)


def test_lead_draft_reports_nested_missing_fields() -> None:
    draft = LeadDraft(contacts=[LeadContactDraft(email="person@example.com")])
    assert draft.missing_fields() == [
        "company_name",
        "contacts[0].name",
        "contacts[0].role",
    ]


def test_filter_operator_shapes_are_validated() -> None:
    with pytest.raises(ValidationError):
        Filter(field="id", operator=FilterOperator.IN, value=[])
    with pytest.raises(ValidationError):
        Filter(field="created_on", operator=FilterOperator.BETWEEN, value=["2026-01-01"])
    assert Filter(field="id", operator=FilterOperator.IS_NULL, value=False)


def test_project_end_date_cannot_precede_start_date() -> None:
    with pytest.raises(ValidationError):
        ProjectDraft(
            customer_id=1,
            name="Migration",
            start_date=date(2026, 7, 2),
            end_date=date(2026, 7, 1),
        )


def test_write_drafts_accept_named_record_references() -> None:
    contact = ContactDraft(lead_id="Acme Corporation", name="Sam", role="Decision Maker")
    activity = ActivityDraft(
        lead_id="Acme Corporation",
        contact_id="Sam",
        activity_type="Call",
        notes="Discussed renewal",
        status="Follow Up",
    )
    project = ProjectDraft(customer_id="Acme Corporation", name="Cloud migration")

    assert contact.lead_id == "Acme Corporation"
    assert activity.contact_id == "Sam"
    assert project.customer_id == "Acme Corporation"


def test_named_record_references_reject_blank_strings() -> None:
    with pytest.raises(ValidationError):
        ContactDraft(lead_id="   ", name="Sam", role="Decision Maker")
