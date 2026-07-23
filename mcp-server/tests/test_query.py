import pytest

from acarsh_mcp.config import Settings
from acarsh_mcp.errors import ValidationError
from acarsh_mcp.models import (
    AggregateFunction,
    AggregateRequest,
    Filter,
    FilterOperator,
    Metric,
    SearchRequest,
    Sort,
)
from acarsh_mcp.query import QueryCompiler


@pytest.fixture
def compiler() -> QueryCompiler:
    return QueryCompiler(Settings(max_page_size=100))


def test_search_values_are_parameterized(compiler: QueryCompiler) -> None:
    malicious = "Acme%' OR 1=1 --"
    compiled = compiler.compile_search(
        SearchRequest(
            entity="leads",
            filters=[
                Filter(
                    field="company_name",
                    operator=FilterOperator.CONTAINS,
                    value=malicious,
                )
            ],
        )
    )
    assert malicious not in compiled.sql
    assert compiled.params["filter_0"] == f"%{malicious}%"
    assert "LIMIT :query_limit OFFSET :query_offset" in compiled.sql


def test_unknown_field_is_rejected_before_sql_generation(compiler: QueryCompiler) -> None:
    with pytest.raises(ValidationError):
        compiler.compile_search(
            SearchRequest(entity="leads", fields=["company_name, (SELECT password FROM Users)"])
        )


def test_page_size_is_capped_by_server_setting(compiler: QueryCompiler) -> None:
    compiled = compiler.compile_search(SearchRequest(entity="leads", limit=500))
    assert compiled.params["query_limit"] == 100


def test_relative_month_filter_is_resolved_before_database_execution(
    compiler: QueryCompiler,
) -> None:
    compiled = compiler.compile_search(
        SearchRequest(
            entity="leads",
            filters=[
                Filter(
                    field="created_on",
                    operator=FilterOperator.GTE,
                    value="this_month",
                )
            ],
        )
    )

    value = compiled.params["filter_0"]
    assert value.day == 1
    assert value.hour == 0
    assert "this_month" not in compiled.params.values()


def test_relative_period_equality_compiles_to_bounded_range(
    compiler: QueryCompiler,
) -> None:
    compiled = compiler.compile_search(
        SearchRequest(
            entity="leads",
            filters=[
                Filter(
                    field="lead_date",
                    operator=FilterOperator.EQ,
                    value="this_month",
                )
            ],
        )
    )

    assert "l.LeadDate >= :filter_0_start" in compiled.sql
    assert "l.LeadDate < :filter_0_end" in compiled.sql
    assert compiled.params["filter_0_start"].day == 1


def test_aggregate_supports_grouped_counts(compiler: QueryCompiler) -> None:
    compiled = compiler.compile_aggregate(
        AggregateRequest(
            entity="leads",
            group_by=["account_type"],
            metrics=[Metric(function=AggregateFunction.COUNT, alias="records")],
            sort=[Sort(field="records", direction="desc")],
        )
    )
    assert "COUNT(*) AS `records`" in compiled.sql
    assert "GROUP BY COALESCE(at.Name, 'Lead')" in compiled.sql
    assert "ORDER BY `records` DESC" in compiled.sql


def test_sum_requires_explicitly_aggregatable_field(compiler: QueryCompiler) -> None:
    with pytest.raises(ValidationError):
        compiler.compile_aggregate(
            AggregateRequest(
                entity="leads",
                metrics=[
                    Metric(
                        function=AggregateFunction.SUM,
                        field="owner_id",
                        alias="bad_metric",
                    )
                ],
            )
        )
