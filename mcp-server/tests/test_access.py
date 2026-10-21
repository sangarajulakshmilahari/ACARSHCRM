import pytest

import acarsh_mcp.access as access_module
from acarsh_mcp.access import (
    ADMIN_ROLE_ID,
    MANAGER_ROLE_ID,
    SALES_EXECUTIVE_ROLE_ID,
    AccessPolicy,
    ActorContext,
    ActorProvider,
    CompanyMembership,
)
from acarsh_mcp.config import Settings
from acarsh_mcp.errors import AccessDeniedError
from acarsh_mcp.models import AggregateFunction, AggregateRequest, Metric, SearchRequest
from acarsh_mcp.query import QueryCompiler


def test_sales_search_scope_is_injected_into_search_and_count() -> None:
    compiler = QueryCompiler(Settings())
    actor = ActorContext(user_id=42, role_id=SALES_EXECUTIVE_ROLE_ID, company_id=9)
    scope = AccessPolicy.for_entity("leads", actor)

    compiled = compiler.compile_search(SearchRequest(entity="leads"), scope)

    assert "l.OwnerId = :scope_user_id" in compiled.sql
    assert "l.OwnerId = :scope_user_id" in (compiled.count_sql or "")
    assert compiled.params["scope_user_id"] == 42
    assert compiled.params["scope_company_id"] == 9
    assert compiled.count_params == {"scope_user_id": 42, "scope_company_id": 9}


def test_sales_scope_is_applied_to_aggregates() -> None:
    compiler = QueryCompiler(Settings())
    actor = ActorContext(user_id=7, role_id=SALES_EXECUTIVE_ROLE_ID, company_id=9)
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
    actor = ActorContext(user_id=1, role_id=MANAGER_ROLE_ID, company_id=9)
    scope = AccessPolicy.for_entity("leads", actor)

    assert scope.clauses == ("l.CompanyId = :scope_company_id",)
    assert scope.params == {"scope_company_id": 9}

def test_missing_company_fails_closed() -> None:
    actor = ActorContext(user_id=1, role_id=MANAGER_ROLE_ID)
    with pytest.raises(AccessDeniedError, match="Company membership required"):
        AccessPolicy.for_entity("leads", actor)


def test_company_scope_is_applied_for_managers_and_sales() -> None:
    manager = ActorContext(user_id=1, role_id=MANAGER_ROLE_ID, company_id=9)
    sales = ActorContext(user_id=42, role_id=SALES_EXECUTIVE_ROLE_ID, company_id=9)

    manager_scope = AccessPolicy.for_entity("leads", manager)
    sales_scope = AccessPolicy.for_entity("leads", sales)

    assert manager_scope.clauses == ("l.CompanyId = :scope_company_id",)
    assert manager_scope.params == {"scope_company_id": 9}
    assert "l.CompanyId = :scope_company_id" in sales_scope.clauses
    assert "l.OwnerId = :scope_user_id" in sales_scope.clauses
    assert sales_scope.params == {"scope_company_id": 9, "scope_user_id": 42}


def test_admin_has_the_same_organization_scope_as_manager() -> None:
    actor = ActorContext(user_id=3, role_id=ADMIN_ROLE_ID, company_id=9)
    scope = AccessPolicy.for_entity("opportunities", actor)

    assert actor.is_manager is True
    assert scope.clauses == ("o.CompanyId = :scope_company_id",)
    assert scope.params == {"scope_company_id": 9}


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
            "x-acarsh-company-id": "11",
        },
    )
    provider = ActorProvider(
        Settings(internal_token="shared-secret"),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )

    actor = provider.current()

    assert actor == ActorContext(
        user_id=9,
        role_id=SALES_EXECUTIVE_ROLE_ID,
        user_name="sales.user",
        company_id=11,
    )


def test_http_actor_rejects_missing_company_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        access_module,
        "get_http_headers",
        lambda: {
            "x-acarsh-user-id": "9",
            "x-acarsh-role-id": "2",
            "x-acarsh-internal-token": "shared-secret",
        },
    )
    provider = ActorProvider(
        Settings(internal_token="shared-secret"),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )
    with pytest.raises(AccessDeniedError, match="Company membership required"):
        provider.current()


def test_stdio_actor_requires_explicit_company(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(access_module, "get_http_headers", lambda: {})
    provider = ActorProvider(
        Settings(
            default_actor_user_id=9,
            default_actor_role_id=2,
            internal_token="unused",
        ),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )
    with pytest.raises(AccessDeniedError, match="Company membership required"):
        provider.current()


def test_stdio_actor_rejects_unverified_default_company(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(access_module, "get_http_headers", lambda: {})
    provider = ActorProvider(
        Settings(
            default_actor_user_id=9,
            default_actor_company_id=99,
            internal_token="unused",
        ),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )
    with pytest.raises(AccessDeniedError, match="not a member"):
        provider.current()


def test_stdio_actor_accepts_explicit_membership_company(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(access_module, "get_http_headers", lambda: {})
    provider = ActorProvider(
        Settings(
            default_actor_user_id=9,
            default_actor_company_id=11,
            internal_token="unused",
        ),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )
    actor = provider.current()
    assert actor == ActorContext(
        user_id=9,
        role_id=SALES_EXECUTIVE_ROLE_ID,
        user_name="",
        company_id=11,
    )


def test_http_actor_rejects_forged_company_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        access_module,
        "get_http_headers",
        lambda: {
            "x-acarsh-user-id": "9",
            "x-acarsh-role-id": "2",
            "x-acarsh-internal-token": "shared-secret",
            "x-acarsh-company-id": "99",
        },
    )
    provider = ActorProvider(
        Settings(internal_token="shared-secret"),
        memberships_for_user=lambda _user_id: [
            CompanyMembership(company_id=11, role_id=SALES_EXECUTIVE_ROLE_ID, is_default=True)
        ],
    )
    with pytest.raises(AccessDeniedError, match="not a member"):
        provider.current()
