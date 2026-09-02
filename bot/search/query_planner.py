"""Query planning — decide the SQL shape for each filter node.

Turns the normalized filter tree into a small intermediate representation that
the compiler renders as parameterized SQLAlchemy statements:

  * Message conditions compile to EXISTS subqueries over ``scraped_messages``
    (satisfied independently per message → member-level semantics, no row
    duplication).
  * An OR group folds into a single EXISTS whose WHERE combines the child
    predicates per-message (then DISTINCT sender_user_id at the top).
  * NOT is absorbed: a negated message condition becomes NOT EXISTS (or a
    negated predicate inside a single EXISTS), a negated member predicate
    becomes ``NOT(...)`` on the outer query.
  * Member/group attribute conditions become direct predicates on the outer
    member query (with group.name resolving through ``scraped_groups``).
  * Claim conditions become EXISTS over ``member_claims``.
  * Scope constraints (group ids, date ranges, message author ids) are pushed
    into every EXISTS and the outer query.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement

from bot.search.filter_ast import Condition, FilterNode

# Sort keys supported by the planner (validated by FilterValidator).
SORT_NEWEST_ACTIVITY = "newest_matching_activity"
SORT_LAST_ACTIVE = "last_active"
SORT_MESSAGE_COUNT = "message_count"
SORT_USERNAME = "username"


@dataclass
class SearchContext:
    """Everything the planner/compiler needs that is not part of the filter.

    ``group_ids`` is the already-scoped set of tg_group_ids (empty = all visible
    groups). ``date_range`` is an optional global message-date window pushed
    into every message EXISTS.
    """

    group_ids: list[int] = field(default_factory=list)
    date_range: dict[str, datetime] | None = None
    agent_id: int | None = None
    tenant_id: int | None = None
    exclude_self_user_id: int | None = None

    def __post_init__(self) -> None:
        self.group_ids = [int(g) for g in self.group_ids]


@dataclass
class ExistsPredicate:
    """A message-scoped EXISTS over scraped_messages (one per AND child)."""

    where: list[ColumnElement] = field(default_factory=list)
    negated: bool = False
    aggregate: bool = False  # requires GROUP BY sender_user_id + HAVING
    having: list[ColumnElement] = field(default_factory=list)


@dataclass
class MemberPredicate:
    """A direct predicate on the outer scraped_members query."""

    expr: ColumnElement
    negated: bool = False


@dataclass
class MessageConditionNode:
    """A single member-message condition in planned form."""

    cond: Condition


@dataclass
class ExistsGroup:
    """A group compiled into a single EXISTS (OR groups, or same-message sets)."""

    conditions: list[PlannedNode]


@dataclass
class PlannedCondition:
    """An already-condensed leaf in planned form."""

    cond: Condition


PlannedNode = Any


def plan(
    node: FilterNode,
    context: SearchContext,
    *,
    mode: str = "member",
) -> list[Any]:
    """Plan a normalized filter node into a list of planner nodes.

    ``mode`` is "member" (default; conditions satisfy independently) or
    "message" (same-message semantics — used for the special same-message
    keyword set). A group's children are planned in the caller's mode; a
    condition carries its own mode (the same-message flag on message.content).
    """
    if isinstance(node, Condition):
        return _plan_condition(node, context, mode)
    # Group
    if node.operator == "OR":
        # Fold into a single EXISTS with per-message OR semantics.
        children = [c for child in node.conditions for c in plan(child, context, mode=mode)]
        return [ExistsGroup(conditions=children)]
    # AND group
    planned: list[Any] = []
    for child in node.conditions:
        planned.extend(plan(child, context, mode=mode))
    return planned


def _plan_condition(cond: Condition, context: SearchContext, mode: str) -> list[Any]:
    field = cond.field
    if field.startswith("message."):
        if field == "message.content":
            cond_mode = cond.match or "substring"
            if cond_mode == "token":
                # tsvector word-boundary match — always its own EXISTS (member-level).
                return [MessageConditionNode(cond=cond)]
            # substring/phrase default to member-level; the caller's mode decides
            # whether this folds into a shared same-message EXISTS.
            if mode == "message" and cond.operator not in ("not_contains", "not_equals"):
                return [MessageConditionNode(cond=cond)]
            return [MessageConditionNode(cond=cond)]
        if field in ("message.created_at", "message.group_id", "message.author_id"):
            # These are scope-ish constraints that apply to every message EXISTS.
            return [MessageConditionNode(cond=cond)]
        return [MessageConditionNode(cond=cond)]

    if field.startswith("member.") and field in (
        "member.username",
        "member.display_name",
        "member.user_id",
        "member.status",
    ):
        return [PlannedCondition(cond=cond)]
    if field.startswith("group."):
        return [PlannedCondition(cond=cond)]
    if field.startswith("member."):
        # message_count / first_message_at / last_message_at / claim_status
        return [PlannedCondition(cond=cond)]
    return [PlannedCondition(cond=cond)]
