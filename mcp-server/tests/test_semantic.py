import pytest

from acarsh_mcp.access import MANAGER_ROLE_ID, SALES_EXECUTIVE_ROLE_ID, ActorContext
from acarsh_mcp.config import Settings
from acarsh_mcp.errors import ValidationError
from acarsh_mcp.models import (
    AggregateFunction,
    Filter,
    FilterOperator,
    HavingCondition,
    Metric,
    RelatedCondition,
    SemanticQueryPlan,
    Sort,
)
from acarsh_mcp.semantic import SemanticQueryCompiler


@pytest.fixture
def compiler() -> SemanticQueryCompiler:
    return SemanticQueryCompiler(Settings(max_page_size=100))


def test_semantic_plan_compiles_role_scoped_not_exists_relationship(
    compiler: SemanticQueryCompiler,
) -> None:
    actor = ActorContext(user_id=42, role_id=SALES_EXECUTIVE_ROLE_ID)
    plan = SemanticQueryPlan(
        entity="leads",
        fields=["company_name", "owner_name", "status"],
        filters=[Filter(field="account_type", value="Prospect")],
        related=[
            RelatedCondition(
                relationship="activities",
                quantifier="not_exists",
                filters=[
                    Filter(
                        field="date",
                        operator=FilterOperator.GTE,
                        value="last_30_days",
                    )
                ],
            )
        ],
    )

    compiled = compiler.compile(plan, actor)

    assert "l.OwnerId = :base_scope_user_id" in compiled.query.sql
    assert "NOT EXISTS" in compiled.query.sql
    assert "a.LeadId = base.`id`" in compiled.query.sql
    assert "a.ActivityDate >= :related_0_filter_0" in compiled.query.sql
    assert compiled.query.params["base_scope_user_id"] == 42
    assert compiled.query.params["related_0_scope_user_id"] == 42
    assert compiled.explanation["raw_sql_accepted"] is False
    resolved = compiled.explanation["relationships"][0]["filters"][0]["resolved_period"]
    assert resolved["start"] < resolved["end_exclusive"]
    assert resolved["timezone"] == compiler.settings.input_timezone


def test_semantic_plan_supports_related_record_count(
    compiler: SemanticQueryCompiler,
) -> None:
    plan = SemanticQueryPlan(
        entity="leads",
        fields=["company_name", "owner_name"],
        related=[RelatedCondition(relationship="contacts", min_count=3)],
    )

    compiled = compiler.compile(
        plan,
        ActorContext(user_id=1, role_id=MANAGER_ROLE_ID),
    )

    assert "COUNT(DISTINCT c.LeadContactID)" in compiled.query.sql
    assert ">= :related_0_min_count" in compiled.query.sql
    assert compiled.query.params["related_0_min_count"] == 3


def test_semantic_plan_supports_grouped_metric_having_and_sort(
    compiler: SemanticQueryCompiler,
) -> None:
    plan = SemanticQueryPlan(
        entity="contacts",
        group_by=["company_name"],
        metrics=[Metric(function=AggregateFunction.COUNT, alias="contact_count")],
        having=[HavingCondition(metric="contact_count", operator="gt", value=3)],
        sort=[Sort(field="contact_count", direction="desc")],
    )

    compiled = compiler.compile(
        plan,
        ActorContext(user_id=1, role_id=MANAGER_ROLE_ID),
    )

    assert compiled.mode == "aggregate"
    assert "GROUP BY base.`company_name`" in compiled.query.sql
    assert "HAVING `contact_count` > :having_0" in compiled.query.sql
    assert "ORDER BY `contact_count` DESC" in compiled.query.sql


def test_semantic_plan_rejects_unknown_relationship(
    compiler: SemanticQueryCompiler,
) -> None:
    plan = SemanticQueryPlan(
        entity="leads",
        related=[RelatedCondition(relationship="raw_database_table")],
    )

    with pytest.raises(ValidationError):
        compiler.compile(plan, ActorContext(user_id=1, role_id=MANAGER_ROLE_ID))
