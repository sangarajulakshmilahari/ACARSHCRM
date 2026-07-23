from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from acarsh_mcp.access import AccessPolicy, AccessScope, ActorProvider
from acarsh_mcp.catalog import EntitySpec, FieldSpec, get_entity
from acarsh_mcp.config import Settings
from acarsh_mcp.db import Database
from acarsh_mcp.errors import NotFoundError, ValidationError
from acarsh_mcp.models import (
    AggregateFunction,
    AggregateRequest,
    Filter,
    FilterOperator,
    SearchRequest,
)

_SAFE_ALIAS = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,49}$")


@dataclass(frozen=True, slots=True)
class CompiledQuery:
    sql: str
    params: dict[str, Any]
    count_sql: str | None = None
    count_params: dict[str, Any] | None = None


class QueryCompiler:
    """Compiles a constrained query DSL; user input is never used as SQL syntax."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _relative_temporal_bounds(
        self,
        field: FieldSpec,
        value: Any,
    ) -> tuple[date | datetime, date | datetime] | None:
        if field.kind not in {"date", "datetime"} or not isinstance(value, str):
            return None
        token = value.strip().lower().replace("-", "_").replace(" ", "_")
        token = {
            "current_week": "this_week",
            "previous_week": "last_week",
            "current_month": "this_month",
            "previous_month": "last_month",
            "current_quarter": "this_quarter",
            "previous_quarter": "last_quarter",
            "current_year": "this_year",
            "previous_year": "last_year",
        }.get(token, token)
        now = datetime.now(ZoneInfo(self.settings.input_timezone))
        today = now.date()

        rolling = re.fullmatch(r"(last|next)_(\d{1,3})_days?", token)
        if rolling:
            direction, raw_days = rolling.groups()
            days = int(raw_days)
            if days < 1 or days > 366:
                raise ValidationError("Rolling date windows must be between 1 and 366 days")
            if direction == "last":
                start_date, end_date = today - timedelta(days=days - 1), today + timedelta(days=1)
            else:
                start_date, end_date = today, today + timedelta(days=days)
        elif token == "today":
            start_date, end_date = today, today + timedelta(days=1)
        elif token == "yesterday":
            start_date, end_date = today - timedelta(days=1), today
        elif token == "this_week":
            start_date = today - timedelta(days=today.weekday())
            end_date = start_date + timedelta(days=7)
        elif token == "last_week":
            end_date = today - timedelta(days=today.weekday())
            start_date = end_date - timedelta(days=7)
        elif token == "this_month":
            start_date = today.replace(day=1)
            end_date = (
                start_date.replace(year=start_date.year + 1, month=1)
                if start_date.month == 12
                else start_date.replace(month=start_date.month + 1)
            )
        elif token == "last_month":
            end_date = today.replace(day=1)
            start_date = (
                end_date.replace(year=end_date.year - 1, month=12)
                if end_date.month == 1
                else end_date.replace(month=end_date.month - 1)
            )
        elif token in {"this_quarter", "last_quarter"}:
            quarter_month = ((today.month - 1) // 3) * 3 + 1
            this_quarter = date(today.year, quarter_month, 1)
            if token == "this_quarter":
                start_date = this_quarter
                end_date = (
                    date(today.year + 1, 1, 1)
                    if quarter_month == 10
                    else date(today.year, quarter_month + 3, 1)
                )
            else:
                end_date = this_quarter
                start_date = (
                    date(today.year - 1, 10, 1)
                    if quarter_month == 1
                    else date(today.year, quarter_month - 3, 1)
                )
        elif token == "this_year":
            start_date = date(today.year, 1, 1)
            end_date = date(today.year + 1, 1, 1)
        elif token == "last_year":
            start_date = date(today.year - 1, 1, 1)
            end_date = date(today.year, 1, 1)
        else:
            return None

        if field.kind == "date":
            return start_date, end_date
        return (
            datetime.combine(start_date, time.min),
            datetime.combine(end_date, time.min),
        )

    @staticmethod
    def _field(entity: EntitySpec, name: str, *, operation: str) -> FieldSpec:
        try:
            spec = entity.fields[name]
        except KeyError as exc:
            raise ValidationError(
                f"Unknown field '{name}' for entity '{entity.name}'.",
                details={"allowed_fields": sorted(entity.fields)},
            ) from exc

        if operation == "filter" and not spec.filterable:
            raise ValidationError(f"Field '{name}' cannot be filtered")
        if operation == "sort" and not spec.sortable:
            raise ValidationError(f"Field '{name}' cannot be sorted")
        return spec

    @staticmethod
    def _alias(name: str) -> str:
        if not _SAFE_ALIAS.fullmatch(name):
            raise ValidationError(f"Unsafe result alias '{name}'")
        return f"`{name}`"

    def _compile_filters(
        self,
        entity: EntitySpec,
        filters: list[Filter],
        scope: AccessScope | None = None,
    ) -> tuple[list[str], dict[str, Any]]:
        clauses = list(entity.base_predicates)
        params: dict[str, Any] = {}
        if scope:
            clauses.extend(scope.clauses)
            params.update(scope.params or {})

        for index, item in enumerate(filters):
            field = self._field(entity, item.field, operation="filter")
            expression = field.expression
            key = f"filter_{index}"
            relative_bounds = self._relative_temporal_bounds(field, item.value)

            if relative_bounds:
                start, end = relative_bounds
                if item.operator == FilterOperator.EQ:
                    clauses.append(f"({expression} >= :{key}_start AND {expression} < :{key}_end)")
                    params[f"{key}_start"] = start
                    params[f"{key}_end"] = end
                elif item.operator == FilterOperator.NE:
                    clauses.append(f"({expression} < :{key}_start OR {expression} >= :{key}_end)")
                    params[f"{key}_start"] = start
                    params[f"{key}_end"] = end
                elif item.operator == FilterOperator.GTE:
                    clauses.append(f"{expression} >= :{key}")
                    params[key] = start
                elif item.operator == FilterOperator.GT:
                    clauses.append(f"{expression} >= :{key}")
                    params[key] = end
                elif item.operator == FilterOperator.LTE:
                    clauses.append(f"{expression} < :{key}")
                    params[key] = end
                elif item.operator == FilterOperator.LT:
                    clauses.append(f"{expression} < :{key}")
                    params[key] = start
                else:
                    raise ValidationError(
                        f"Relative date '{item.value}' cannot be used with "
                        f"operator '{item.operator}'"
                    )
                continue

            if item.operator == FilterOperator.EQ:
                clauses.append(f"{expression} = :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.NE:
                clauses.append(f"{expression} <> :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.CONTAINS:
                clauses.append(f"LOWER(CAST({expression} AS CHAR)) LIKE LOWER(:{key})")
                params[key] = f"%{item.value}%"
            elif item.operator == FilterOperator.STARTS_WITH:
                clauses.append(f"LOWER(CAST({expression} AS CHAR)) LIKE LOWER(:{key})")
                params[key] = f"{item.value}%"
            elif item.operator == FilterOperator.IN:
                placeholders = []
                for value_index, value in enumerate(item.value):
                    value_key = f"{key}_{value_index}"
                    placeholders.append(f":{value_key}")
                    params[value_key] = value
                clauses.append(f"{expression} IN ({', '.join(placeholders)})")
            elif item.operator == FilterOperator.GT:
                clauses.append(f"{expression} > :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.GTE:
                clauses.append(f"{expression} >= :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.LT:
                clauses.append(f"{expression} < :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.LTE:
                clauses.append(f"{expression} <= :{key}")
                params[key] = item.value
            elif item.operator == FilterOperator.BETWEEN:
                clauses.append(f"{expression} BETWEEN :{key}_from AND :{key}_to")
                params[f"{key}_from"], params[f"{key}_to"] = item.value
            elif item.operator == FilterOperator.IS_NULL:
                clauses.append(f"{expression} IS {'NULL' if item.value else 'NOT NULL'}")
            else:  # pragma: no cover - enum validation normally makes this unreachable
                raise ValidationError(f"Unsupported operator '{item.operator}'")

        return clauses, params

    def compile_search(
        self, request: SearchRequest, scope: AccessScope | None = None
    ) -> CompiledQuery:
        entity = get_entity(request.entity)
        selected = list(dict.fromkeys(request.fields or entity.default_fields))
        if entity.primary_key not in selected:
            selected.insert(0, entity.primary_key)

        select_parts = []
        for name in selected:
            spec = self._field(entity, name, operation="select")
            select_parts.append(f"{spec.expression} AS {self._alias(name)}")

        clauses, params = self._compile_filters(entity, request.filters, scope)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        sorts = request.sort or [
            # The request model uses the same public shape, so tuples are sufficient here.
            type("DefaultSort", (), {"field": field, "direction": direction})()
            for field, direction in entity.default_sort
        ]
        order_parts = []
        for item in sorts:
            spec = self._field(entity, item.field, operation="sort")
            direction = "DESC" if item.direction == "desc" else "ASC"
            order_parts.append(f"{spec.expression} {direction}")

        limit = min(request.limit, self.settings.max_page_size)
        params.update({"query_limit": limit, "query_offset": request.offset})
        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM {entity.from_clause}
            {where_sql}
            ORDER BY {", ".join(order_parts)}
            LIMIT :query_limit OFFSET :query_offset
        """
        count_sql = f"SELECT COUNT(*) AS total FROM {entity.from_clause} {where_sql}"
        count_params = {key: value for key, value in params.items() if not key.startswith("query_")}
        return CompiledQuery(sql=sql, params=params, count_sql=count_sql, count_params=count_params)

    def compile_get(
        self,
        entity_name: str,
        record_id: int,
        scope: AccessScope | None = None,
    ) -> CompiledQuery:
        entity = get_entity(entity_name)
        request = SearchRequest(
            entity=entity_name,
            filters=[Filter(field=entity.primary_key, operator=FilterOperator.EQ, value=record_id)],
            fields=list(entity.fields),
            limit=1,
        )
        return self.compile_search(request, scope)

    def compile_aggregate(
        self, request: AggregateRequest, scope: AccessScope | None = None
    ) -> CompiledQuery:
        entity = get_entity(request.entity)
        group_parts: list[str] = []
        select_parts: list[str] = []

        for name in request.group_by:
            spec = self._field(entity, name, operation="select")
            select_parts.append(f"{spec.expression} AS {self._alias(name)}")
            group_parts.append(spec.expression)

        metric_aliases: dict[str, str] = {}
        for index, metric in enumerate(request.metrics):
            field_spec = None
            if metric.field:
                field_spec = self._field(entity, metric.field, operation="select")

            if metric.function in {
                AggregateFunction.SUM,
                AggregateFunction.AVG,
            } and (field_spec is None or not field_spec.aggregatable):
                raise ValidationError(
                    f"Field '{metric.field}' is not enabled for {metric.function}"
                )
            if metric.function in {
                AggregateFunction.MIN,
                AggregateFunction.MAX,
            } and (field_spec is None or field_spec.sensitive):
                raise ValidationError(
                    f"Field '{metric.field}' is not enabled for {metric.function}"
                )

            if metric.function == AggregateFunction.COUNT:
                expression = "COUNT(*)"
            elif metric.function == AggregateFunction.COUNT_DISTINCT:
                expression = f"COUNT(DISTINCT {field_spec.expression})"
            else:
                expression = f"{metric.function.value.upper()}({field_spec.expression})"

            default_alias = (
                metric.function.value
                if not metric.field
                else f"{metric.function.value}_{metric.field}"
            )
            alias = metric.alias or default_alias or f"metric_{index}"
            if alias in metric_aliases or alias in request.group_by:
                raise ValidationError(f"Duplicate aggregate alias '{alias}'")
            metric_aliases[alias] = expression
            select_parts.append(f"{expression} AS {self._alias(alias)}")

        clauses, params = self._compile_filters(entity, request.filters, scope)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        group_sql = f"GROUP BY {', '.join(group_parts)}" if group_parts else ""

        order_parts = []
        for item in request.sort:
            direction = "DESC" if item.direction == "desc" else "ASC"
            if item.field in metric_aliases or item.field in request.group_by:
                order_parts.append(f"{self._alias(item.field)} {direction}")
            else:
                raise ValidationError(
                    f"Aggregate sort field '{item.field}' must be a group or metric alias"
                )

        if not order_parts:
            first_metric = next(iter(metric_aliases))
            order_parts.append(f"{self._alias(first_metric)} DESC")

        limit = min(request.limit, self.settings.max_page_size)
        params["query_limit"] = limit
        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM {entity.from_clause}
            {where_sql}
            {group_sql}
            ORDER BY {", ".join(order_parts)}
            LIMIT :query_limit
        """
        return CompiledQuery(sql=sql, params=params)


class QueryService:
    def __init__(
        self,
        database: Database,
        compiler: QueryCompiler,
        actors: ActorProvider,
    ) -> None:
        self.database = database
        self.compiler = compiler
        self.actors = actors

    def _scope(self, entity: str) -> AccessScope:
        actor = self.actors.current()
        assert actor is not None
        return AccessPolicy.for_entity(entity, actor)

    def search(self, request: SearchRequest) -> dict:
        compiled = self.compiler.compile_search(request, self._scope(request.entity))
        rows = self.database.fetch_all(compiled.sql, compiled.params)
        total_row = self.database.fetch_one(compiled.count_sql or "", compiled.count_params)
        total = int((total_row or {}).get("total", len(rows)))
        return {
            "status": "ok",
            "entity": request.entity,
            "items": rows,
            "pagination": {
                "limit": min(request.limit, self.compiler.settings.max_page_size),
                "offset": request.offset,
                "returned": len(rows),
                "total": total,
            },
        }

    def get_record(self, entity: str, record_id: int) -> dict:
        compiled = self.compiler.compile_get(entity, record_id, self._scope(entity))
        row = self.database.fetch_one(compiled.sql, compiled.params)
        if row is None:
            raise NotFoundError(f"No {entity} record found with id {record_id}")
        return {"status": "ok", "entity": entity, "record": row}

    def aggregate(self, request: AggregateRequest) -> dict:
        compiled = self.compiler.compile_aggregate(request, self._scope(request.entity))
        rows = self.database.fetch_all(compiled.sql, compiled.params)
        return {"status": "ok", "entity": request.entity, "items": rows}
