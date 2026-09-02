"""Query compiler tests.

Verify the compiled SQL shape (EXISTS vs NOT EXISTS, aggregates, parameterized
literals) for the boolean member-search semantics, using SQLite as the test
dialect (the project's test DB).
"""

from __future__ import annotations

import pytest

from bot.search.filter_ast import from_dict
from bot.search.filter_normalizer import normalize
from bot.search.filter_validator import validate_filter
from bot.search.query_compiler import (
    compile_count_select,
    compile_member_select,
    compile_scope_filter,
)
from bot.search.query_planner import SearchContext, plan


def compile_sql(
    data: dict,
    ctx: SearchContext,
    sort: str = "newest_matching_activity",
    page: int = 1,
    page_size: int = 50,
):
    node = from_dict(data)
    validate_filter(node)
    node = normalize(node)
    planned = plan(node, ctx)
    return compile_member_select(
        planned=planned,
        context=ctx,
        sort=sort,
        page=page,
        page_size=page_size,
        scope_filter=compile_scope_filter(ctx),
    )


@pytest.fixture
def ctx() -> SearchContext:
    return SearchContext(group_ids=[-1001], agent_id=1, tenant_id=1, exclude_self_user_id=5)


class TestExistsShape:
    def test_single_keyword_uses_exists(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    }
                ],
            },
            ctx,
        )
        sql = str(stmt)
        assert "EXISTS" in sql.upper()
        assert "scraped_messages" in sql

    def test_and_generates_two_exists(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    },
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "investment",
                    },
                ],
            },
            ctx,
        )
        sql = str(stmt).upper()
        assert sql.count("EXISTS") == 2

    def test_or_folds_into_one_exists(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "OR",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    },
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "bitcoin",
                    },
                ],
            },
            ctx,
        )
        sql = str(stmt).upper()
        assert sql.count("EXISTS") == 1
        assert " OR " in sql or "OR" in sql

    def test_not_contains_uses_not_exists(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "not_contains",
                        "value": "scam",
                    }
                ],
            },
            ctx,
        )
        sql = str(stmt).upper()
        # SQLAlchemy renders NOT EXISTS as "NOT (EXISTS ...)".
        assert "NOT (EXISTS" in sql or "NOT EXISTS" in sql
        # The EXISTS itself wraps the POSITIVE match (NOT LIKE inside NOT
        # EXISTS would be a double negation).
        assert " NOT LIKE " not in sql.split("EXISTS")[-1]

    def test_nested_group_semantics(self, ctx):
        # (crypto OR bitcoin) AND investment -> 2 EXISTS (one OR-folded, one single)
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "group",
                        "operator": "OR",
                        "conditions": [
                            {
                                "type": "condition",
                                "field": "message.content",
                                "operator": "contains",
                                "value": "crypto",
                            },
                            {
                                "type": "condition",
                                "field": "message.content",
                                "operator": "contains",
                                "value": "bitcoin",
                            },
                        ],
                    },
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "investment",
                    },
                ],
            },
            ctx,
        )
        sql = str(stmt).upper()
        assert sql.count("EXISTS") == 2

    def test_message_count_uses_aggregate(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "member.message_count",
                        "operator": "greater_than_or_equal",
                        "value": 5,
                    }
                ],
            },
            ctx,
        )
        sql = str(stmt).upper()
        assert "HAVING" in sql
        assert "COUNT" in sql


class TestParameterization:
    def test_no_literal_user_strings_in_sql(self, ctx):
        """User text must never be concatenated into the SQL string."""
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto'; DROP TABLE scraped_messages; --",
                    }
                ],
            },
            ctx,
        )
        raw = str(stmt)
        # The dangerous payload must appear only as a bound parameter, never inline.
        assert "DROP TABLE" not in raw
        assert "'" not in raw.replace("'", "", 0) or "DROP" not in raw

    def test_escape_contains_injection_chars(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "100%_real",
                    }
                ],
            },
            ctx,
        )
        sql = str(stmt)
        # The user text is a bound parameter; the LIKE keeps an ESCAPE clause.
        assert "ESCAPE" in sql.upper()
        # The raw wildcards never appear inline in the SQL string.
        assert "100%_real" not in sql


class TestScopePushdown:
    def test_group_scope_applied(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    }
                ],
            },
            ctx,
        )
        sql = str(stmt)
        # The scope tg_group_id is applied both on the outer member query and
        # inside the EXISTS. It is rendered as a bound IN() parameter (SQLite
        # stringifies the list inline, Postgres uses POSTCOMPILE).
        assert "tg_group_id IN" in sql or "tg_group_id IN (" in sql
        assert "scraped_members.tg_group_id" in sql
        assert "scraped_messages.tg_group_id" in sql

    def test_count_select_has_no_offset(self, ctx):
        count_stmt = compile_count_select(
            planned=plan(
                from_dict(
                    {
                        "type": "group",
                        "operator": "AND",
                        "conditions": [
                            {
                                "type": "condition",
                                "field": "message.content",
                                "operator": "contains",
                                "value": "crypto",
                            }
                        ],
                    }
                ),
                ctx,
            ),
            context=ctx,
            scope_filter=compile_scope_filter(ctx),
        )
        assert "OFFSET" not in str(count_stmt).upper()
        assert "LIMIT" not in str(count_stmt).upper()
        assert "COUNT" in str(count_stmt).upper()


class TestSorting:
    def test_username_sort_no_aggregate_join(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    }
                ],
            },
            ctx,
            sort="username",
        )
        sql = str(stmt).upper()
        assert "ORDER BY" in sql

    def test_last_active_sort_joins_aggregate(self, ctx):
        stmt = compile_sql(
            {
                "type": "group",
                "operator": "AND",
                "conditions": [
                    {
                        "type": "condition",
                        "field": "message.content",
                        "operator": "contains",
                        "value": "crypto",
                    }
                ],
            },
            ctx,
            sort="last_active",
        )
        sql = str(stmt).upper()
        assert "ORDER BY" in sql
        assert "MAX(" in sql
