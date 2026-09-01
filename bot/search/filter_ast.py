"""Filter AST — the canonical, JSON-serializable representation of a member search.

The Mini App sends this tree to the API; the backend validates, normalizes and
compiles it into parameterized SQL. Keeping it a plain dataclass tree (no
ORM/SQL types) lets the same structure later power saved filters, MCP tools and
campaign targeting without changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class Condition:
    """A single filter predicate.

    ``value`` is typed per field/operator: str for text, int for numeric
    scalars, list[int] for multi-keyword conditions, and
    {"from": ..., "to": ...} for between/date-range operators.
    """

    field: str
    operator: str
    value: Any
    # message.content only: "substring" (default), "token" (tsvector word
    # match) or "phrase" (exact phrase within a single message).
    match: str | None = None


@dataclass
class FilterGroup:
    """A boolean group of conditions / nested groups.

    ``operator`` is "AND" or "OR". NOT is expressed by negated conditions
    (``not_contains``, ``not_equals``) and by nested NOT groups — see
    FilterNormalizer. ``conditions`` is never empty after validation.
    """

    operator: Literal["AND", "OR"]
    conditions: list[FilterNode] = field(default_factory=list)


FilterNode = Condition | FilterGroup

GROUP_OPERATORS: tuple[str, ...] = ("AND", "OR")

# Message content match modes.
MATCH_SUBSTRING = "substring"
MATCH_TOKEN = "token"
MATCH_PHRASE = "phrase"
MATCH_MODES: tuple[str, ...] = (MATCH_SUBSTRING, MATCH_TOKEN, MATCH_PHRASE)


def is_group(node: FilterNode) -> bool:
    return isinstance(node, FilterGroup)


def is_condition(node: FilterNode) -> bool:
    return isinstance(node, Condition)


def to_dict(node: FilterNode) -> dict[str, Any]:
    """Serialize a filter node to the wire format (dict tree)."""
    if isinstance(node, Condition):
        out: dict[str, Any] = {
            "type": "condition",
            "field": node.field,
            "operator": node.operator,
            "value": node.value,
        }
        if node.match is not None:
            out["match"] = node.match
        return out
    return {
        "type": "group",
        "operator": node.operator,
        "conditions": [to_dict(child) for child in node.conditions],
    }


def from_dict(data: Any) -> FilterNode:
    """Parse a wire-format dict tree into FilterNode dataclasses.

    Raises FilterValidationError on structurally invalid input. Semantic
    validation (allowlists, operator/field matrix, limits) happens later in
    FilterValidator.
    """
    from bot.search.exceptions import FilterValidationError

    if not isinstance(data, dict):
        raise FilterValidationError("Filter must be an object", code="INVALID_FILTER")
    node_type = data.get("type")
    if node_type == "condition":
        field = data.get("field")
        operator = data.get("operator")
        if not isinstance(field, str) or not field:
            raise FilterValidationError("Condition 'field' must be a non-empty string")
        if not isinstance(operator, str) or not operator:
            raise FilterValidationError("Condition 'operator' must be a non-empty string")
        value = data.get("value")
        match = data.get("match")
        if match is not None and not isinstance(match, str):
            raise FilterValidationError("Condition 'match' must be a string")
        return Condition(field=field, operator=operator, value=value, match=match)
    if node_type == "group":
        operator = data.get("operator")
        conditions = data.get("conditions")
        if operator not in GROUP_OPERATORS:
            raise FilterValidationError(
                f"Group operator must be one of {', '.join(GROUP_OPERATORS)}"
            )
        if not isinstance(conditions, list):
            raise FilterValidationError("Group 'conditions' must be an array")
        return FilterGroup(operator=operator, conditions=[from_dict(c) for c in conditions])
    raise FilterValidationError("Filter node must have type 'condition' or 'group'")


def node_signature(node: FilterNode) -> tuple:
    """Hashable signature used by the normalizer for deduplication."""
    if isinstance(node, Condition):
        return ("c", node.field, node.operator, node.match, _freeze_value(node.value))
    return ("g", node.operator, tuple(node_signature(c) for c in node.conditions))


def _freeze_value(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(_freeze_value(v) for v in value)
    if isinstance(value, dict):
        return tuple(sorted((k, _freeze_value(v)) for k, v in value.items()))
    return value
