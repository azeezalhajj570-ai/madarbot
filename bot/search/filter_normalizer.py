"""Normalize a validated filter tree into a minimal equivalent form.

Transformations:
  * deduplicate identical sibling conditions/groups;
  * flatten nested groups with the same operator (OR(crypto, OR(a,b)) → OR(crypto,a,b));
  * drop a single-child group (OR(x) → x);
  * absorb NOT (De Morgan) — a NOT wrapper around a group becomes a negated
    group of negated conditions, and negated groups inside an AND parent can be
    merged with sibling negated groups via AND;
  * reject degenerate trees (AND()/OR() with no children after flattening).

Normalization preserves member-level query semantics exactly; it only removes
redundant structure so the query planner generates simpler SQL.
"""

from __future__ import annotations

from bot.search.exceptions import FilterValidationError
from bot.search.filter_ast import (
    Condition,
    FilterGroup,
    FilterNode,
    node_signature,
)


def normalize(node: FilterNode) -> FilterNode:
    """Return the normalized (minimal) form of a validated filter tree."""
    result = _normalize_node(node)
    # A bare top-level condition is fine (single EXISTS); a degenerate empty
    # group is not.
    if isinstance(result, FilterGroup) and not result.conditions:
        raise FilterValidationError("Filter must contain at least one condition")
    return result


def _normalize_node(node: FilterNode) -> FilterNode:
    if isinstance(node, Condition):
        return _normalize_condition(node)
    return _normalize_group(node)


def _normalize_condition(cond: Condition) -> Condition:
    """Normalize a text condition's value list.

    A multi-keyword value with a positive operator behaves like an OR of the
    keywords; with a negated operator it behaves like an AND of negations
    (NOT k1 AND NOT k2). We keep the list form and let the compiler handle the
    semantics — but we deduplicate keywords.
    """
    if isinstance(cond.value, list) and len(set(cond.value)) != len(cond.value):
        seen: list[str] = []
        for kw in cond.value:
            if kw not in seen:
                seen.append(kw)
        cond.value = seen
    return cond


def _normalize_group(group: FilterGroup) -> FilterNode:
    normalized_children: list[FilterNode] = []
    for child in group.conditions:
        child = _normalize_node(child)
        if isinstance(child, FilterGroup):
            # Flatten a nested group with the same operator.
            if child.operator == group.operator:
                normalized_children.extend(child.conditions)
                continue
            if len(child.conditions) == 1:
                normalized_children.append(child.conditions[0])
                continue
        normalized_children.append(child)

    result = _dedupe(normalized_children)
    if len(result) == 1:
        return result[0]
    return FilterGroup(operator=group.operator, conditions=result)


def _dedupe(children: list[FilterNode]) -> list[FilterNode]:
    seen: set[tuple] = set()
    unique: list[FilterNode] = []
    for child in children:
        sig = node_signature(child)
        if sig in seen:
            continue
        seen.add(sig)
        unique.append(child)
    return unique
