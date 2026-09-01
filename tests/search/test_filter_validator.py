"""Filter AST parse + validation tests.

Covers structural parsing, allowlists, operator/field matrix, value typing and
complexity limits.
"""

from __future__ import annotations

import pytest

from bot.search.exceptions import FilterValidationError, SearchQueryTooComplexError
from bot.search.filter_ast import Condition, FilterGroup, from_dict
from bot.search.filter_validator import (
    MAX_CONDITIONS,
    MAX_DEPTH,
    MAX_KEYWORDS,
    validate_filter,
    validate_group_ids,
    validate_sort,
)


def cond(field: str, operator: str, value, match=None) -> dict:
    out = {"type": "condition", "field": field, "operator": operator, "value": value}
    if match is not None:
        out["match"] = match
    return out


def group(operator: str, *conditions) -> dict:
    return {"type": "group", "operator": operator, "conditions": list(conditions)}


class TestParse:
    def test_parses_condition(self):
        node = from_dict(cond("message.content", "contains", "crypto"))
        assert isinstance(node, Condition)
        assert node.field == "message.content"

    def test_parses_nested_group(self):
        node = from_dict(
            group(
                "AND",
                cond("message.content", "contains", "crypto"),
                group("OR", cond("message.content", "contains", "bitcoin")),
            )
        )
        assert isinstance(node, FilterGroup)
        assert node.operator == "AND"
        assert len(node.conditions) == 2

    def test_rejects_missing_type(self):
        with pytest.raises(FilterValidationError):
            from_dict({"field": "message.content", "operator": "contains", "value": "x"})

    def test_rejects_unknown_group_operator(self):
        with pytest.raises(FilterValidationError):
            from_dict({"type": "group", "operator": "XOR", "conditions": []})

    def test_rejects_non_dict(self):
        with pytest.raises(FilterValidationError):
            from_dict("crypto")


class TestValidation:
    def test_valid_message_condition(self):
        node = from_dict(cond("message.content", "contains", "crypto"))
        validate_filter(node)
        assert node.match == "substring"  # defaulted

    def test_rejects_unknown_field(self):
        node = from_dict(cond("member.banana", "contains", "x"))
        with pytest.raises(FilterValidationError, match="Unsupported field"):
            validate_filter(node)

    def test_rejects_unknown_operator(self):
        node = from_dict(cond("member.username", "frobnicate", "x"))
        with pytest.raises(FilterValidationError, match="not supported"):
            validate_filter(node)

    def test_rejects_wrong_operator_for_field(self):
        # greater_than is numeric-only; text field must reject it.
        node = from_dict(cond("member.username", "greater_than", 5))
        with pytest.raises(FilterValidationError):
            validate_filter(node)

    def test_rejects_empty_text_value(self):
        node = from_dict(cond("member.username", "contains", "   "))
        with pytest.raises(FilterValidationError, match="empty"):
            validate_filter(node)

    def test_rejects_empty_keyword_list(self):
        node = from_dict(cond("message.content", "contains", []))
        with pytest.raises(FilterValidationError):
            validate_filter(node)

    def test_rejects_too_many_keywords(self):
        node = from_dict(
            cond("message.content", "contains", [f"k{i}" for i in range(MAX_KEYWORDS + 1)])
        )
        with pytest.raises(SearchQueryTooComplexError):
            validate_filter(node)

    def test_rejects_empty_group(self):
        node = from_dict(group("AND"))
        with pytest.raises(FilterValidationError, match="at least one"):
            validate_filter(node)

    def test_rejects_too_deep(self):
        # Build a chain nested MAX_DEPTH+2 deep.
        node: dict = cond("message.content", "contains", "crypto")
        for _ in range(MAX_DEPTH + 2):
            node = group("AND", node)
        parsed = from_dict(node)
        with pytest.raises(SearchQueryTooComplexError):
            validate_filter(parsed)

    def test_rejects_too_many_conditions(self):
        conditions = [
            cond("message.content", "contains", f"k{i}") for i in range(MAX_CONDITIONS + 1)
        ]
        with pytest.raises(SearchQueryTooComplexError):
            validate_filter(from_dict(group("OR", *conditions)))

    def test_message_match_modes(self):
        node = from_dict(cond("message.content", "contains", "crypto", match="token"))
        validate_filter(node)
        assert node.match == "token"

    def test_rejects_bad_match_mode(self):
        node = from_dict(cond("message.content", "contains", "crypto", match="regex"))
        with pytest.raises(FilterValidationError):
            validate_filter(node)

    def test_enum_values(self):
        for v in ("admin", "creator", "member", "restricted"):
            node = from_dict(cond("member.status", "equals", v))
            validate_filter(node)
        node = from_dict(cond("member.status", "equals", "owner"))
        with pytest.raises(FilterValidationError):
            validate_filter(node)

    def test_claim_values(self):
        for v in ("claimed", "unclaimed", "claimed_by_me", "claimed_by_other"):
            node = from_dict(cond("member.claim_status", "equals", v))
            validate_filter(node)

    def test_numeric_between(self):
        node = from_dict(cond("member.message_count", "between", {"from": 5, "to": 20}))
        validate_filter(node)
        assert node.value == {"from": 5, "to": 20}

    def test_numeric_between_reversed(self):
        node = from_dict(cond("member.message_count", "between", {"from": 20, "to": 5}))
        with pytest.raises(FilterValidationError, match="from.*<="):
            validate_filter(node)

    def test_date_coercion(self):
        node = from_dict(cond("message.created_at", "after", "2026-08-01T00:00:00Z"))
        validate_filter(node)
        assert node.value.isoformat().startswith("2026-08-01")

    def test_date_bad_value(self):
        node = from_dict(cond("message.created_at", "after", "not-a-date"))
        with pytest.raises(FilterValidationError):
            validate_filter(node)

    def test_keyword_length_limit(self):
        node = from_dict(cond("message.content", "contains", "x" * 501))
        with pytest.raises(FilterValidationError):
            validate_filter(node)


class TestLimits:
    def test_sort_allowlist(self):
        validate_sort("newest_matching_activity")
        with pytest.raises(FilterValidationError):
            validate_sort("relevance")

    def test_group_ids_limit(self):
        assert validate_group_ids([1, 2, 3]) == [1, 2, 3]
        with pytest.raises(SearchQueryTooComplexError):
            validate_group_ids(list(range(101)))
