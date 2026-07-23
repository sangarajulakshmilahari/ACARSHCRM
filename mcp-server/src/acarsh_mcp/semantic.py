from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

from acarsh_mcp.access import AccessPolicy, AccessScope, ActorContext, ActorProvider
from acarsh_mcp.catalog import EntitySpec, get_entity, get_relationship
from acarsh_mcp.config import Settings
from acarsh_mcp.db import Database
from acarsh_mcp.errors import ValidationError
from acarsh_mcp.models import (
    AggregateFunction,
    Filter,
    FilterGroup,
    RelatedCondition,
    SemanticQueryPlan,
)
from acarsh_mcp.query import CompiledQuery, QueryCompiler


@dataclass(frozen=True, slots=True)
class CompiledSemanticQuery:
    query: CompiledQuery
    mode: str
    explanation: dict[str, Any]


class SemanticQueryCompiler:
    """Compile model-generated plans without accepting SQL syntax from the model."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.filters = QueryCompiler(settings)

    @staticmethod
    def _rename_parameters(
        clauses: list[str],
        params: dict[str, Any],
        prefix: str,
    ) -> tuple[list[str], dict[str, Any]]:
        renamed_clauses = list(clauses)
        renamed_params: dict[str, Any] = {}
        for key in sorted(params, key=len, reverse=True):
            renamed = f"{prefix}_{key}"
            pattern = re.compile(rf":{re.escape(key)}\b")
            renamed_clauses = [pattern.sub(f":{renamed}", clause) for clause in renamed_clauses]
            renamed_params[renamed] = params[key]
        return renamed_clauses, renamed_params

    def _filter_clauses(
        self,
        entity: EntitySpec,
        filters: list[Filter],
        *,
        prefix: str,
        scope: AccessScope | None = None,
    ) -> tuple[list[str], dict[str, Any]]:
        clauses, params = self.filters._compile_filters(entity, filters, scope)
        return self._rename_parameters(clauses, params, prefix)

    def _group_clause(
        self,
        entity: EntitySpec,
        group: FilterGroup,
        *,
        prefix: str,
    ) -> tuple[str, dict[str, Any]]:
        group_entity = replace(entity, base_predicates=())
        clauses, params = self._filter_clauses(
            group_entity,
            group.filters,
            prefix=prefix,
        )
        operator = " AND " if group.match == "all" else " OR "
        return f"({operator.join(clauses)})", params

    def _base_query(
        self,
        entity: EntitySpec,
        actor: ActorContext,
    ) -> tuple[str, dict[str, Any], EntitySpec]:
        selected = [
            f"{field.expression} AS {self.filters._alias(name)}"
            for name, field in entity.fields.items()
        ]
        clauses, params = self._filter_clauses(
            entity,
            [],
            prefix="base",
            scope=AccessPolicy.for_entity(entity.name, actor),
        )
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT {', '.join(selected)} FROM {entity.from_clause} {where_sql}"
        wrapped_fields = {
            name: replace(field, expression=f"base.{self.filters._alias(name)}")
            for name, field in entity.fields.items()
        }
        wrapper = replace(
            entity,
            from_clause=f"({sql}) base",
            fields=wrapped_fields,
            base_predicates=(),
        )
        return sql, params, wrapper

    def _relationship_clause(
        self,
        source: EntitySpec,
        wrapper: EntitySpec,
        condition: RelatedCondition,
        actor: ActorContext,
        index: int,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        relationship = get_relationship(source.name, condition.relationship)
        target = get_entity(relationship.target_entity)
        if relationship.source_field not in wrapper.fields:
            raise ValidationError(f"Relationship '{relationship.name}' has an invalid source field")
        if relationship.target_field not in target.fields:
            raise ValidationError(f"Relationship '{relationship.name}' has an invalid target field")

        prefix = f"related_{index}"
        clauses, params = self._filter_clauses(
            target,
            condition.filters,
            prefix=prefix,
            scope=AccessPolicy.for_entity(target.name, actor),
        )
        source_expression = wrapper.fields[relationship.source_field].expression
        target_expression = target.fields[relationship.target_field].expression
        clauses.insert(0, f"{target_expression} = {source_expression}")

        for group_index, group in enumerate(condition.filter_groups):
            group_clause, group_params = self._group_clause(
                target,
                group,
                prefix=f"{prefix}_group_{group_index}",
            )
            clauses.append(group_clause)
            params.update(group_params)

        related_where = f"WHERE {' AND '.join(clauses)}"
        if condition.min_count is not None or condition.max_count is not None:
            primary_expression = target.fields[target.primary_key].expression
            count_sql = (
                f"(SELECT COUNT(DISTINCT {primary_expression}) "
                f"FROM {target.from_clause} {related_where})"
            )
            bounds: list[str] = []
            if condition.min_count is not None:
                key = f"{prefix}_min_count"
                bounds.append(f"{count_sql} >= :{key}")
                params[key] = condition.min_count
            if condition.max_count is not None:
                key = f"{prefix}_max_count"
                bounds.append(f"{count_sql} <= :{key}")
                params[key] = condition.max_count
            clause = f"({' AND '.join(bounds)})"
        else:
            exists_sql = f"EXISTS (SELECT 1 FROM {target.from_clause} {related_where})"
            clause = f"NOT {exists_sql}" if condition.quantifier == "not_exists" else exists_sql

        explanation = {
            "relationship": relationship.name,
            "target_entity": target.name,
            "quantifier": condition.quantifier,
            "min_count": condition.min_count,
            "max_count": condition.max_count,
            "filters": [self._explain_filter(target, item) for item in condition.filters],
            "filter_groups": [
                self._explain_filter_group(target, item) for item in condition.filter_groups
            ],
        }
        return clause, params, explanation

    def _where(
        self,
        plan: SemanticQueryPlan,
        source: EntitySpec,
        wrapper: EntitySpec,
        actor: ActorContext,
    ) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
        clauses, params = self._filter_clauses(
            wrapper,
            plan.filters,
            prefix="plan",
        )
        for index, group in enumerate(plan.filter_groups):
            clause, group_params = self._group_clause(
                wrapper,
                group,
                prefix=f"plan_group_{index}",
            )
            clauses.append(clause)
            params.update(group_params)

        relationship_explanations = []
        for index, condition in enumerate(plan.related):
            clause, related_params, explanation = self._relationship_clause(
                source,
                wrapper,
                condition,
                actor,
                index,
            )
            clauses.append(clause)
            params.update(related_params)
            relationship_explanations.append(explanation)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return where_sql, params, relationship_explanations

    def _compile_records(
        self,
        plan: SemanticQueryPlan,
        source: EntitySpec,
        wrapper: EntitySpec,
        base_sql: str,
        base_params: dict[str, Any],
        actor: ActorContext,
    ) -> CompiledSemanticQuery:
        selected = list(dict.fromkeys(plan.fields or source.default_fields))
        if source.primary_key not in selected:
            selected.insert(0, source.primary_key)
        select_parts = []
        for name in selected:
            field = self.filters._field(wrapper, name, operation="select")
            select_parts.append(f"{field.expression} AS {self.filters._alias(name)}")

        where_sql, params, related_explanations = self._where(plan, source, wrapper, actor)
        sorts = plan.sort or [
            type("DefaultSort", (), {"field": field, "direction": direction})()
            for field, direction in source.default_sort
        ]
        order_parts = []
        for item in sorts:
            field = self.filters._field(wrapper, item.field, operation="sort")
            direction = "DESC" if item.direction == "desc" else "ASC"
            order_parts.append(f"{field.expression} {direction}")

        limit = min(plan.limit, self.settings.max_page_size)
        params = {**base_params, **params, "query_limit": limit, "query_offset": plan.offset}
        from_sql = f"({base_sql}) base"
        sql = (
            f"SELECT {', '.join(select_parts)} FROM {from_sql} {where_sql} "
            f"ORDER BY {', '.join(order_parts)} "
            "LIMIT :query_limit OFFSET :query_offset"
        )
        count_sql = f"SELECT COUNT(*) AS total FROM {from_sql} {where_sql}"
        count_params = {key: value for key, value in params.items() if not key.startswith("query_")}
        explanation = self._explanation(
            plan,
            source,
            actor,
            mode="records",
            fields=selected,
            relationships=related_explanations,
        )
        return CompiledSemanticQuery(
            query=CompiledQuery(sql, params, count_sql, count_params),
            mode="records",
            explanation=explanation,
        )

    def _compile_aggregate(
        self,
        plan: SemanticQueryPlan,
        source: EntitySpec,
        wrapper: EntitySpec,
        base_sql: str,
        base_params: dict[str, Any],
        actor: ActorContext,
    ) -> CompiledSemanticQuery:
        where_sql, params, related_explanations = self._where(plan, source, wrapper, actor)
        select_parts: list[str] = []
        group_parts: list[str] = []
        for name in plan.group_by:
            field = self.filters._field(wrapper, name, operation="select")
            select_parts.append(f"{field.expression} AS {self.filters._alias(name)}")
            group_parts.append(field.expression)

        metric_expressions: dict[str, str] = {}
        for metric in plan.metrics:
            field = (
                self.filters._field(wrapper, metric.field, operation="select")
                if metric.field
                else None
            )
            if metric.function in {AggregateFunction.SUM, AggregateFunction.AVG} and (
                field is None or not field.aggregatable
            ):
                raise ValidationError(
                    f"Field '{metric.field}' is not enabled for {metric.function}"
                )
            if metric.function in {AggregateFunction.MIN, AggregateFunction.MAX} and (
                field is None or field.sensitive
            ):
                raise ValidationError(
                    f"Field '{metric.field}' is not enabled for {metric.function}"
                )
            if metric.function == AggregateFunction.COUNT:
                expression = "COUNT(*)"
            elif metric.function == AggregateFunction.COUNT_DISTINCT:
                expression = f"COUNT(DISTINCT {field.expression})"
            else:
                expression = f"{metric.function.value.upper()}({field.expression})"
            alias = metric.alias or (
                metric.function.value
                if not metric.field
                else f"{metric.function.value}_{metric.field}"
            )
            if alias in metric_expressions or alias in plan.group_by:
                raise ValidationError(f"Duplicate aggregate alias '{alias}'")
            metric_expressions[alias] = expression
            select_parts.append(f"{expression} AS {self.filters._alias(alias)}")

        having_parts = []
        operator_sql = {
            "eq": "=",
            "ne": "<>",
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
        }
        for index, condition in enumerate(plan.having):
            if condition.metric not in metric_expressions:
                raise ValidationError(
                    f"Unknown having metric '{condition.metric}'",
                    details={"allowed_metrics": sorted(metric_expressions)},
                )
            key = f"having_{index}"
            having_parts.append(
                f"{self.filters._alias(condition.metric)} {operator_sql[condition.operator]} :{key}"
            )
            params[key] = condition.value

        sort_parts = []
        for item in plan.sort:
            if item.field not in metric_expressions and item.field not in plan.group_by:
                raise ValidationError(
                    f"Aggregate sort field '{item.field}' must be a group or metric alias"
                )
            direction = "DESC" if item.direction == "desc" else "ASC"
            sort_parts.append(f"{self.filters._alias(item.field)} {direction}")
        if not sort_parts:
            sort_parts.append(f"{self.filters._alias(next(iter(metric_expressions)))} DESC")

        group_sql = f"GROUP BY {', '.join(group_parts)}" if group_parts else ""
        having_sql = f"HAVING {' AND '.join(having_parts)}" if having_parts else ""
        limit = min(plan.limit, self.settings.max_page_size)
        params = {**base_params, **params, "query_limit": limit, "query_offset": plan.offset}
        sql = (
            f"SELECT {', '.join(select_parts)} FROM ({base_sql}) base {where_sql} "
            f"{group_sql} {having_sql} ORDER BY {', '.join(sort_parts)} "
            "LIMIT :query_limit OFFSET :query_offset"
        )
        explanation = self._explanation(
            plan,
            source,
            actor,
            mode="aggregate",
            fields=plan.group_by,
            relationships=related_explanations,
        )
        return CompiledSemanticQuery(
            query=CompiledQuery(sql, params),
            mode="aggregate",
            explanation=explanation,
        )

    def _explain_filter(self, entity: EntitySpec, item: Filter) -> dict[str, Any]:
        explanation = item.model_dump(mode="json")
        field = entity.fields.get(item.field)
        if field is None:
            return explanation
        bounds = self.filters._relative_temporal_bounds(field, item.value)
        if bounds:
            start, end = bounds
            explanation["resolved_period"] = {
                "start": start.isoformat(),
                "end_exclusive": end.isoformat(),
                "timezone": self.settings.input_timezone,
            }
        return explanation

    def _explain_filter_group(
        self,
        entity: EntitySpec,
        group: FilterGroup,
    ) -> dict[str, Any]:
        return {
            "match": group.match,
            "filters": [self._explain_filter(entity, item) for item in group.filters],
        }

    def _explanation(
        self,
        plan: SemanticQueryPlan,
        source: EntitySpec,
        actor: ActorContext,
        *,
        mode: str,
        fields: list[str],
        relationships: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "mode": mode,
            "entity": plan.entity,
            "fields": fields,
            "filters": [self._explain_filter(source, item) for item in plan.filters],
            "filter_groups": [
                self._explain_filter_group(source, item) for item in plan.filter_groups
            ],
            "relationships": relationships,
            "group_by": plan.group_by,
            "metrics": [item.model_dump(mode="json") for item in plan.metrics],
            "having": [item.model_dump(mode="json") for item in plan.having],
            "sort": [item.model_dump(mode="json") for item in plan.sort],
            "access_scope": "organization" if actor.is_manager else "role_scoped_records",
            "parameterized": True,
            "raw_sql_accepted": False,
        }

    def compile(
        self,
        plan: SemanticQueryPlan,
        actor: ActorContext,
    ) -> CompiledSemanticQuery:
        source = get_entity(plan.entity)
        base_sql, base_params, wrapper = self._base_query(source, actor)
        if plan.group_by or plan.metrics or plan.having:
            return self._compile_aggregate(plan, source, wrapper, base_sql, base_params, actor)
        return self._compile_records(plan, source, wrapper, base_sql, base_params, actor)


class SemanticQueryService:
    def __init__(
        self,
        database: Database,
        compiler: SemanticQueryCompiler,
        actors: ActorProvider,
    ) -> None:
        self.database = database
        self.compiler = compiler
        self.actors = actors

    def execute(self, plan: SemanticQueryPlan) -> dict[str, Any]:
        actor = self.actors.current()
        assert actor is not None
        compiled = self.compiler.compile(plan, actor)
        rows = self.database.fetch_all(compiled.query.sql, compiled.query.params)
        result: dict[str, Any] = {
            "status": "ok",
            "entity": plan.entity,
            "mode": compiled.mode,
            "items": rows,
            "explanation": compiled.explanation,
        }
        if compiled.mode == "records":
            total_row = self.database.fetch_one(
                compiled.query.count_sql or "",
                compiled.query.count_params,
            )
            result["pagination"] = {
                "limit": min(plan.limit, self.compiler.settings.max_page_size),
                "offset": plan.offset,
                "returned": len(rows),
                "total": int((total_row or {}).get("total", len(rows))),
            }
        return result
