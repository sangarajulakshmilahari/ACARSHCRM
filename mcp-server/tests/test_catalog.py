import pytest

from acarsh_mcp.catalog import ENTITIES, get_entity, get_lookup, public_catalog
from acarsh_mcp.errors import ValidationError


def test_catalog_covers_core_crm_entities() -> None:
    assert {
        "leads",
        "contacts",
        "activities",
        "reminders",
        "opportunities",
        "projects",
        "project_resources",
    } <= set(ENTITIES)


def test_public_catalog_does_not_expose_sql_expressions() -> None:
    catalog = public_catalog()
    lead_field = catalog["entities"]["leads"]["fields"]["company_name"]
    assert "expression" not in lead_field
    assert lead_field["type"] == "string"


def test_unknown_entity_and_lookup_are_rejected() -> None:
    with pytest.raises(ValidationError):
        get_entity("Leads; DROP TABLE Users")
    with pytest.raises(ValidationError):
        get_lookup("anything")
