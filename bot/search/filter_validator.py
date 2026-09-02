"""Server-side validation of the member-search filter AST.

All user-controlled input (fields, operators, values, group ids, sort) is
checked against allowlists and limits here — the SQL compiler never trusts the
client. Values are always bound as parameters; nothing from the client is ever
concatenated into SQL.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from bot.search.exceptions import FilterValidationError, SearchQueryTooComplexError
from bot.search.filter_ast import (
    MATCH_MODES,
    Condition,
    FilterGroup,
    FilterNode,
)

MAX_DEPTH = 10
MAX_CONDITIONS = 100
MAX_KEYWORD_LENGTH = 500
MAX_KEYWORDS = 50
MAX_GROUP_IDS = 100

# ── Field allowlists ──────────────────────────────────────────────────────

MEMBER_FIELDS: dict[str, tuple[str, ...]] = {
    "member.username": ("text",),
    "member.display_name": ("text",),
    "member.user_id": ("numeric",),
    "member.status": ("enum",),
    "member.claim_status": ("claim",),
    "member.message_count": ("numeric",),
    "member.first_message_at": ("date",),
    "member.last_message_at": ("date",),
}
GROUP_FIELDS: dict[str, tuple[str, ...]] = {
    "group.id": ("numeric",),
    "group.name": ("text",),
}
MESSAGE_FIELDS: dict[str, tuple[str, ...]] = {
    "message.content": ("text",),
    "message.created_at": ("date",),
    "message.group_id": ("numeric",),
    "message.author_id": ("numeric",),
}
ALLOWED_FIELDS: dict[str, tuple[str, ...]] = {
    **MEMBER_FIELDS,
    **GROUP_FIELDS,
    **MESSAGE_FIELDS,
}

TEXT_OPERATORS: tuple[str, ...] = (
    "contains",
    "not_contains",
    "equals",
    "not_equals",
    "starts_with",
    "ends_with",
)
NUMERIC_OPERATORS: tuple[str, ...] = (
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "between",
)
DATE_OPERATORS: tuple[str, ...] = ("before", "after", "between")

ALLOWED_OPERATORS: dict[str, tuple[str, ...]] = {
    "text": TEXT_OPERATORS,
    "numeric": NUMERIC_OPERATORS,
    "date": DATE_OPERATORS,
    "enum": ("equals", "not_equals"),
    "claim": ("equals", "not_equals"),
}

MEMBER_STATUS_VALUES: tuple[str, ...] = ("admin", "creator", "member", "restricted")
CLAIM_STATUS_VALUES: tuple[str, ...] = (
    "claimed",
    "unclaimed",
    "claimed_by_me",
    "claimed_by_other",
)

ALLOWED_SORTS: tuple[str, ...] = (
    "newest_matching_activity",
    "last_active",
    "message_count",
    "username",
)

# ── Public entry ──────────────────────────────────────────────────────────


def validate_filter(node: FilterNode) -> FilterNode:
    """Validate a parsed filter tree in place.

    Returns the (possibly rejected) node; raises FilterValidationError /
    SearchQueryTooComplexError on any violation.
    """
    counts = {"conditions": 0}
    _walk(node, depth=0, counts=counts)
    return node


def validate_sort(sort: str) -> str:
    if sort not in ALLOWED_SORTS:
        raise FilterValidationError(f"Invalid sort '{sort}'. Valid: {', '.join(ALLOWED_SORTS)}")
    return sort


def validate_group_ids(group_ids: list[int] | None) -> list[int]:
    if not group_ids:
        return []
    if len(group_ids) > MAX_GROUP_IDS:
        raise SearchQueryTooComplexError(f"Too many groups (max {MAX_GROUP_IDS})")
    return group_ids


# ── Internals ─────────────────────────────────────────────────────────────


def _walk(node: FilterNode, *, depth: int, counts: dict[str, int]) -> None:
    if depth > MAX_DEPTH:
        raise SearchQueryTooComplexError(f"Filter is too deep (max depth {MAX_DEPTH})")
    if isinstance(node, FilterGroup):
        if not node.conditions:
            raise FilterValidationError(
                f"Group '{node.operator}' must contain at least one condition"
            )
        for child in node.conditions:
            _walk(child, depth=depth + 1, counts=counts)
        return

    counts["conditions"] += 1
    if counts["conditions"] > MAX_CONDITIONS:
        raise SearchQueryTooComplexError(f"Too many conditions (max {MAX_CONDITIONS})")
    _validate_condition(node)


def _validate_condition(cond: Condition) -> None:
    if cond.field not in ALLOWED_FIELDS:
        raise FilterValidationError(
            f"Unsupported field '{cond.field}'",
            field=cond.field,
        )
    kind = ALLOWED_FIELDS[cond.field][0]
    allowed = ALLOWED_OPERATORS[kind]
    if cond.operator not in allowed:
        raise FilterValidationError(
            f"Operator '{cond.operator}' is not supported for field '{cond.field}'",
            field=cond.field,
        )
    if cond.field == "message.content":
        if cond.match is None:
            cond.match = "substring"
        elif cond.match not in MATCH_MODES:
            raise FilterValidationError(
                f"Unsupported match mode '{cond.match}' for message.content",
                field=cond.field,
            )
        if cond.match in ("token", "phrase") and cond.operator not in ("contains", "not_contains"):
            raise FilterValidationError(
                f"Match mode '{cond.match}' requires a contains/not_contains operator",
                field=cond.field,
            )
    else:
        cond.match = None

    if kind == "enum":
        _validate_enum(cond)
    elif kind == "claim":
        _validate_claim(cond)
    elif kind == "text":
        _validate_text(cond)
    elif kind == "numeric":
        _validate_numeric(cond)
    elif kind == "date":
        _validate_date(cond)


def _validate_enum(cond: Condition) -> None:
    value = _expect_str(cond)
    normalized = value.lower()
    if normalized not in MEMBER_STATUS_VALUES:
        raise FilterValidationError(
            f"Invalid member.status value '{value}'. Valid: {', '.join(MEMBER_STATUS_VALUES)}",
            field=cond.field,
        )
    cond.value = normalized


def _validate_claim(cond: Condition) -> None:
    value = _expect_str(cond)
    normalized = value.lower()
    if normalized not in CLAIM_STATUS_VALUES:
        raise FilterValidationError(
            f"Invalid member.claim_status value '{value}'. Valid: {', '.join(CLAIM_STATUS_VALUES)}",
            field=cond.field,
        )
    cond.value = normalized


def _validate_text(cond: Condition) -> None:
    if isinstance(cond.value, list):
        _validate_keyword_list(cond)
        return
    value = _expect_str(cond)
    stripped = value.strip()
    if not stripped:
        raise FilterValidationError("Text value must not be empty", field=cond.field)
    if len(stripped) > MAX_KEYWORD_LENGTH:
        raise FilterValidationError(
            f"Value is too long (max {MAX_KEYWORD_LENGTH} characters)", field=cond.field
        )
    cond.value = stripped


def _validate_keyword_list(cond: Condition) -> None:
    if not cond.value:
        raise FilterValidationError("Keyword list must not be empty", field=cond.field)
    if len(cond.value) > MAX_KEYWORDS:
        raise SearchQueryTooComplexError(
            f"Too many keywords (max {MAX_KEYWORDS})", field=cond.field
        )
    cleaned: list[str] = []
    for item in cond.value:
        if not isinstance(item, str):
            raise FilterValidationError("Keywords must be strings", field=cond.field)
        stripped = item.strip()
        if not stripped:
            raise FilterValidationError("Keywords must not be empty", field=cond.field)
        if len(stripped) > MAX_KEYWORD_LENGTH:
            raise FilterValidationError(
                f"Keyword is too long (max {MAX_KEYWORD_LENGTH} characters)", field=cond.field
            )
        cleaned.append(stripped)
    cond.value = cleaned


def _validate_numeric(cond: Condition) -> None:
    if cond.operator == "between":
        if not isinstance(cond.value, dict):
            raise FilterValidationError(
                "Numeric 'between' requires an object {from, to}", field=cond.field
            )
        low = _coerce_number(cond.value.get("from"), cond)
        high = _coerce_number(cond.value.get("to"), cond)
        if low > high:
            raise FilterValidationError("'from' must be <= 'to'", field=cond.field)
        cond.value = {"from": low, "to": high}
        return
    cond.value = _coerce_number(cond.value, cond)


def _coerce_number(value: Any, cond: Condition) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FilterValidationError(
            f"Field '{cond.field}' requires a numeric value", field=cond.field
        )
    return int(value) if isinstance(value, int) else value


def _validate_date(cond: Condition) -> None:
    if cond.operator == "between":
        if not isinstance(cond.value, dict):
            raise FilterValidationError(
                "Date 'between' requires an object {from, to}", field=cond.field
            )
        low = _coerce_datetime(cond.value.get("from"), cond)
        high = _coerce_datetime(cond.value.get("to"), cond)
        if low > high:
            raise FilterValidationError("'from' must be <= 'to'", field=cond.field)
        cond.value = {"from": low, "to": high}
        return
    cond.value = _coerce_datetime(cond.value, cond)


def _coerce_datetime(value: Any, cond: Condition) -> datetime:
    if not isinstance(value, str):
        raise FilterValidationError(
            f"Field '{cond.field}' requires an ISO-8601 date string", field=cond.field
        )
    normalized = value[:-1] + "+00:00" if value.endswith(("Z", "z")) else value
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        raise FilterValidationError(
            f"Invalid date value for '{cond.field}': {value!r}", field=cond.field
        ) from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _expect_str(cond: Condition) -> str:
    if not isinstance(cond.value, str):
        raise FilterValidationError(
            f"Field '{cond.field}' requires a string value", field=cond.field
        )
    return cond.value
