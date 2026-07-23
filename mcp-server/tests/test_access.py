import pytest

import acarsh_mcp.access as access_module
from acarsh_mcp.access import (
    MANAGER_ROLE_ID,
    SALES_EXECUTIVE_ROLE_ID,
    AccessPolicy,
    ActorContext,
    ActorProvider,
)
from acarsh_mcp.config import Settings
from acarsh_mcp.errors import AccessDeniedError
from acarsh_mcp.models import AggregateFunction, AggregateRequest, Metric, SearchRequest
from acarsh_mcp.query import QueryCompiler


def test_sales_search_scope_is_injected_into_search_and_count() -> None:
    compiler = QueryCompiler(Settings())
    actor = ActorContext(user_id=42, role_id=SALES_EXECUTIVE_ROLE_ID)
    scope = AccessPolicy.for_entity("leads", actor)

    compiled = compiler.compile_search(SearchRequest(entity="leads"), scope)

    assert "l.OwnerId = :scope_user_id" in compiled.sql
    assert "l.OwnerId = :scope_user_id" in (compiled.count_sql or "")
    assert compiled.params["scope_user_id"] == 42
    assert compiled.count_params == {"scope_user_id": 42}


def test_sales_scope_is_applied_to_aggregates() -> None:
    compiler = QueryCompiler(Settings())
    actor = ActorContext(user_id=7, role_id=SALES_EXECUTIVE_ROLE_ID)
    scope = AccessPolicy.for_entity("opportunities", actor)

    compiled = compiler.compile_aggregate(
        AggregateRequest(
            entity="opportunities",
            metrics=[Metric(function=AggregateFunction.COUNT, alias="records")],
        ),
        scope,
    )

    assert "l.OwnerId = :scope_user_id" in compiled.sql
    assert compiled.params["scope_user_id"] == 7


def test_manager_scope_does_not_add_owner_filter() -> None:
    actor = ActorContext(user_id=1, role_id=MANAGER_ROLE_ID)
    scope = AccessPolicy.for_entity("leads", actor)

    assert scope.clauses == ()
    assert scope.params is None


def test_http_actor_requires_matching_internal_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        access_module,
        "get_http_headers",
        lambda: {
            "x-acarsh-user-id": "9",
            "x-acarsh-role-id": "2",
            "x-acarsh-internal-token": "wrong",
        },
    )
    provider = ActorProvider(Settings(internal_token="expected"))

    with pytest.raises(AccessDeniedError):
        provider.current()


def test_http_actor_is_accepted_with_matching_internal_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_module,
        "get_http_headers",
        lambda: {
            "x-acarsh-user-id": "9",
            "x-acarsh-role-id": "2",
            "x-acarsh-user-name": "sales.user",
            "x-acarsh-internal-token": "shared-secret",
        },
    )
    provider = ActorProvider(Settings(internal_token="shared-secret"))

    actor = provider.current()

    assert actor == ActorContext(
        user_id=9,
        role_id=SALES_EXECUTIVE_ROLE_ID,
        user_name="sales.user",
    )
