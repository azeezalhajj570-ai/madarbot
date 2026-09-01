"""Filter normalization tests — dedup, flattening, single-child collapse."""

from __future__ import annotations

import pytest

from bot.search.exceptions import FilterValidationError
from bot.search.filter_ast import Condition, FilterGroup, from_dict
from bot.search.filter_normalizer import normalize


def cond(field: str, operator: str, value) -> dict:
    return {"type": "condition", "field": field, "operator": operator, "value": value}


def group(operator: str, *conditions) -> dict:
    return {"type": "group", "operator": operator, "conditions": list(conditions)}


def run(data: dict):
    return normalize(from_dict(data))


class TestNormalize:
    def test_keeps_single_condition(self):
        result = run(cond("message.content", "contains", "crypto"))
        assert isinstance(result, Condition)
        assert result.value == "crypto"

    def test_flattens_same_operator_nested_group(self):
        # OR(crypto, OR(bitcoin, ethereum)) -> OR(crypto, bitcoin, ethereum)
        result = run(
            group(
                "OR",
                cond("message.content", "contains", "crypto"),
                group(
                    "OR",
                    cond("message.content", "contains", "bitcoin"),
                    cond("message.content", "contains", "ethereum"),
                ),
            )
        )
        assert isinstance(result, FilterGroup)
        assert result.operator == "OR"
        assert len(result.conditions) == 3

    def test_collapses_single_child_group(self):
        # AND(OR(crypto)) -> crypto
        result = run(group("AND", group("OR", cond("message.content", "contains", "crypto"))))
        assert isinstance(result, Condition)
        assert result.value == "crypto"

    def test_deduplicates_identical_conditions(self):
        result = run(
            group(
                "AND",
                cond("message.content", "contains", "crypto"),
                cond("message.content", "contains", "crypto"),
            )
        )
        assert isinstance(result, Condition)  # AND(crypto, crypto) -> crypto
        assert result.value == "crypto"

    def test_does_not_dedupe_different_operators(self):
        result = run(
            group(
                "AND",
                cond("message.content", "contains", "crypto"),
                cond("message.content", "not_contains", "crypto"),
            )
        )
        assert isinstance(result, FilterGroup)
        assert len(result.conditions) == 2

    def test_deduplicates_keywords(self):
        result = run(cond("message.content", "contains", ["crypto", "crypto", "bitcoin"]))
        assert result.value == ["crypto", "bitcoin"]

    def test_preserves_or_with_distinct_children(self):
        result = run(
            group(
                "OR",
                cond("message.content", "contains", "crypto"),
                cond("message.content", "contains", "bitcoin"),
            )
        )
        assert isinstance(result, FilterGroup)
        assert len(result.conditions) == 2

    def test_empty_group_rejected(self):
        with pytest.raises(FilterValidationError):
            run(group("AND"))

    def test_nested_group_with_different_operator_kept(self):
        result = run(
            group(
                "AND",
                cond("message.content", "contains", "crypto"),
                group(
                    "OR",
                    cond("message.content", "contains", "bitcoin"),
                    cond("message.content", "contains", "ethereum"),
                ),
            )
        )
        assert isinstance(result, FilterGroup)
        assert len(result.conditions) == 2
        nested = result.conditions[1]
        assert isinstance(nested, FilterGroup)
        assert nested.operator == "OR"
        assert len(nested.conditions) == 2
