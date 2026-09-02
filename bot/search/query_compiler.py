"""Compile the planned filter into parameterized SQLAlchemy statements.

Every user-supplied literal becomes a bound parameter; text operators render
ILIKE with escaped wildcards. The compiler emits two statements:

  * the member select (outer scraped_members query with per-member predicates,
    EXISTS subqueries, aggregates, sorting and pagination);
  * an optional exact-count select (only used when the caller explicitly wants
    a total and the result set is small).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    Select,
    and_,
    exists,
    func,
    literal_column,
    or_,
    select,
)
from sqlalchemy.sql import ColumnElement

from bot.db.models import MemberClaim, ScrapedGroup, ScrapedMember, ScrapedMessage
from bot.search.filter_ast import Condition
from bot.search.query_planner import (
    SORT_LAST_ACTIVE,
    SORT_MESSAGE_COUNT,
    SORT_USERNAME,
    ExistsGroup,
    ExistsPredicate,
    MemberPredicate,
    MessageConditionNode,
    PlannedCondition,
    SearchContext,
)

_GROUP_TITLE = func.lower(func.coalesce(ScrapedGroup.title, ""))
_MEMBER_USERNAME = func.lower(func.coalesce(ScrapedMember.username, ""))
_MEMBER_DISPLAY = func.lower(
    func.coalesce(ScrapedMember.full_name, "")
    .concat(" ")
    .concat(func.coalesce(ScrapedMember.first_name, ""))
    .concat(" ")
    .concat(func.coalesce(ScrapedMember.last_name, ""))
)

ESCAPE = "\\"


def compile_member_select(
    *,
    planned: list[Any],
    context: SearchContext,
    sort: str,
    page: int,
    page_size: int,
    scope_filter: ColumnElement | None = None,
) -> Select:
    """Build the outer member SELECT with EXISTS/aggregate/predicate clauses."""
    outer_predicates: list[ColumnElement] = []
    exists_predicates: list[ExistsPredicate] = []

    for item in planned:
        _accumulate(item, context, outer_predicates, exists_predicates)

    stmt = select(
        ScrapedMember.tg_user_id,
        ScrapedMember.username,
        ScrapedMember.full_name,
        ScrapedMember.first_name,
        ScrapedMember.last_name,
        ScrapedMember.role,
        ScrapedMember.is_bot,
        ScrapedMember.tg_group_id,
    ).where(ScrapedMember.tg_user_id.isnot(None))

    if scope_filter is not None:
        stmt = stmt.where(scope_filter)

    stmt = stmt.where(*outer_predicates)
    for ep in exists_predicates:
        subq = _build_exists_subquery(ep, context)
        if ep.negated:
            stmt = stmt.where(~exists(subq))
        else:
            stmt = stmt.where(exists(subq))

    stmt = _apply_sort(stmt, sort=sort, context=context)
    # Fetch limit+1 so the repository can compute has_more without a COUNT.
    stmt = stmt.offset((page - 1) * page_size).limit(page_size + 1)
    return stmt


def compile_count_select(
    *, planned: list[Any], context: SearchContext, scope_filter: ColumnElement | None = None
) -> Select:
    """Build a COUNT(*) over the same filtered member set (small sets only)."""
    outer_predicates: list[ColumnElement] = []
    exists_predicates: list[ExistsPredicate] = []
    for item in planned:
        _accumulate(item, context, outer_predicates, exists_predicates)

    stmt = select(func.count(ScrapedMember.tg_user_id)).where(ScrapedMember.tg_user_id.isnot(None))
    if scope_filter is not None:
        stmt = stmt.where(scope_filter)
    stmt = stmt.where(*outer_predicates)
    for ep in exists_predicates:
        subq = _build_exists_subquery(ep, context)
        if ep.negated:
            stmt = stmt.where(~exists(subq))
        else:
            stmt = stmt.where(exists(subq))
    return stmt


def compile_scope_filter(
    context: SearchContext, *, eligible_member_subq: Select | None = None
) -> ColumnElement | None:
    """Outer scraped_members scope: visible groups + agent-owned scraped rows.

    ``eligible_member_subq`` optionally restricts the outer rows to members the
    acting agent can actually add (scraped by this agent or legacy NULL rows),
    keeping the search universe aligned with the member picker.
    """
    clauses: list[ColumnElement] = []
    if context.group_ids:
        clauses.append(ScrapedMember.tg_group_id.in_(context.group_ids))
    if context.exclude_self_user_id is not None:
        clauses.append(ScrapedMember.tg_user_id != context.exclude_self_user_id)
    if eligible_member_subq is not None:
        clauses.append(ScrapedMember.id.in_(eligible_member_subq))
    return and_(*clauses) if clauses else None


def _accumulate(
    item: Any,
    context: SearchContext,
    outer: list[ColumnElement],
    exists_preds: list[ExistsPredicate],
) -> None:
    if isinstance(item, MessageConditionNode):
        exists_preds.append(_message_exists(item.cond, context))
    elif isinstance(item, ExistsGroup):
        exists_preds.append(_exists_group(item, context))
    elif isinstance(item, MemberPredicate):
        if item.negated:
            outer.append(~item.expr)
        else:
            outer.append(item.expr)
    elif isinstance(item, PlannedCondition):
        _accumulate_member_condition(item.cond, context, outer, exists_preds)
    elif isinstance(item, Condition):
        # Bare condition (group of one) — treat as member/message leaf.
        _accumulate_member_condition(item, context, outer, exists_preds)


# ── Per-leaf planning helpers ─────────────────────────────────────────────


def _message_exists(cond: Condition, context: SearchContext) -> ExistsPredicate:
    """Build an EXISTS over matching messages.

    A negated condition (not_contains/not_equals) is expressed as
    ``NOT EXISTS(... positive predicate ...)`` — the member has NO message
    satisfying the positive form. Putting the negation inside the EXISTS (a
    NOT LIKE inside NOT EXISTS) would invert the semantics.
    """
    where: list[ColumnElement] = [ScrapedMessage.sender_user_id == ScrapedMember.tg_user_id]
    where.extend(_message_scope_clauses(context))
    negated = cond.operator in ("not_contains", "not_equals")
    # For a negated operator we need NOT EXISTS(<POSITIVE match>): pass
    # negate=True so the predicate renders positive, then wrap in NOT EXISTS.
    where.extend(_message_content_predicates(cond, context, negate=negated))
    return ExistsPredicate(where=where, negated=negated)


def _exists_group(group: ExistsGroup, context: SearchContext) -> ExistsPredicate:
    """Fold an OR/same-message group into one EXISTS (per-message boolean)."""
    where: list[ColumnElement] = [ScrapedMessage.sender_user_id == ScrapedMember.tg_user_id]
    where.extend(_message_scope_clauses(context))
    inner: list[ColumnElement] = []
    for child in group.conditions:
        if isinstance(child, MessageConditionNode):
            # Inside a positive EXISTS, negated conditions become NOT LIKE
            # (the EXISTS itself stays positive).
            inner.extend(
                _message_content_predicates(
                    child.cond,
                    context,
                    negate=child.cond.operator in ("not_contains", "not_equals"),
                )
            )
        elif isinstance(child, PlannedCondition):
            inner.extend(_member_predicate_in_message_scope(child.cond, context))
        else:
            inner.extend(_message_content_predicates(child.cond, context))
    if inner:
        where.append(or_(*inner))
    return ExistsPredicate(where=where, negated=False)


def _message_scope_clauses(context: SearchContext) -> list[ColumnElement]:
    clauses: list[ColumnElement] = []
    if context.group_ids:
        clauses.append(ScrapedMessage.tg_group_id.in_(context.group_ids))
    if context.date_range:
        if context.date_range.get("from"):
            clauses.append(ScrapedMessage.message_date >= context.date_range["from"])
        if context.date_range.get("to"):
            clauses.append(ScrapedMessage.message_date <= context.date_range["to"])
    return clauses


def _message_content_predicates(
    cond: Condition, context: SearchContext, *, negate: bool = False
) -> list[ColumnElement]:
    """Render message.content (and date/group/author scope) predicates for an EXISTS.

    ``negate`` inverts the content predicate (used when the whole EXISTS is
    wrapped in NOT EXISTS).
    """
    if cond.field == "message.content":
        return _text_predicates_on_message(cond, negate=negate)
    if cond.field == "message.created_at":
        return _date_predicates(ScrapedMessage.message_date, cond)
    if cond.field == "message.group_id":
        return [ScrapedMessage.tg_group_id == _int_value(cond)]
    if cond.field == "message.author_id":
        return [ScrapedMessage.sender_user_id == _int_value(cond)]
    return []


def _text_predicates_on_message(cond: Condition, *, negate: bool = False) -> list[ColumnElement]:
    """Render the message-content predicate for an EXISTS.

    ``negate=True`` means the caller is already wrapping the EXISTS in
    NOT EXISTS, so the positive match is rendered (NOT EXISTS(<matches>)).
    For a negated operator without that wrapper (e.g. inside a positive
    EXISTS), the predicate itself is inverted.
    """
    value = cond.value
    is_negated_op = cond.operator in ("not_contains", "not_equals")
    # effective_negate = True means render the NEGATED predicate.
    #   - ``negate=True`` (caller wraps EXISTS in NOT) → render the POSITIVE
    #     predicate (NOT EXISTS(positive)) — so flip the operator's negation.
    #   - ``negate=False`` with a negated operator → render the NEGATED
    #     predicate (used inside a positive EXISTS, e.g. OR group).
    effective_negate = (not is_negated_op) if negate else is_negated_op
    if isinstance(value, list):
        if effective_negate:
            # NONE mode inside a positive EXISTS: NOT k1 AND NOT k2.
            return [and_(*[_text_predicate_on_message(cond, kw, negate=True) for kw in value])]
        return [or_(*[_text_predicate_on_message(cond, kw) for kw in value])]
    return [_text_predicate_on_message(cond, value, negate=effective_negate)]


def _text_predicate_on_message(
    cond: Condition, term: str, *, negate: bool = False
) -> ColumnElement:
    """Render the positive predicate for ``term``; ``negate`` inverts it.

    The caller (``_text_predicates_on_message``) already folds a negated
    operator into ``negate``, so this function renders the *base* match for
    contains/not_contains/equals/not_equals and applies only the explicit
    ``negate`` — keeping ``NOT EXISTS(positive-match)`` correct.
    """
    op = cond.operator
    match = cond.match or "substring"
    column = ScrapedMessage.message_text
    if match == "token" and op in ("contains", "not_contains"):
        ts_query = func.websearch_to_tsquery("arabic", term)
        pred: ColumnElement = ScrapedMessage.search_vector.op("@@")(ts_query)
        return ~pred if negate else pred
    if op in ("contains", "not_contains"):
        pattern = f"%{_escape_like(term)}%"
        pred = column.ilike(pattern, escape=ESCAPE)
        return ~pred if negate else pred
    if op == "starts_with":
        pred = column.ilike(f"{_escape_like(term)}%", escape=ESCAPE)
        return ~pred if negate else pred
    if op == "ends_with":
        pred = column.ilike(f"%{_escape_like(term)}", escape=ESCAPE)
        return ~pred if negate else pred
    if op in ("equals", "not_equals"):
        pred = func.lower(func.coalesce(column, "")) == term.lower()
        return ~pred if negate else pred
    # Unreachable for text on message.content; keep a safe default.
    pred = column.ilike(f"%{_escape_like(term)}%", escape=ESCAPE)
    return ~pred if negate else pred


def _member_predicate_in_message_scope(
    cond: Condition, context: SearchContext
) -> list[ColumnElement]:
    """Member-level conditions inside an OR/same-message EXISTS fold into the message query."""
    field = cond.field
    if field == "member.user_id":
        return [ScrapedMessage.sender_user_id == _int_value(cond)]
    if field == "member.status":
        return [
            ScrapedMessage.sender_user_id.in_(
                select(ScrapedMember.tg_user_id).where(
                    ScrapedMember.role == _str_value(cond), ScrapedMember.tg_user_id.isnot(None)
                )
            )
        ]
    return []


# ── Outer member predicates ───────────────────────────────────────────────


def _accumulate_member_condition(
    cond: Condition,
    context: SearchContext,
    outer: list[ColumnElement],
    exists_preds: list[ExistsPredicate],
) -> None:
    field = cond.field
    if field.startswith("member."):
        if field == "member.username":
            outer.append(_text_predicate_on_member(_MEMBER_USERNAME, cond))
        elif field == "member.display_name":
            outer.append(_text_predicate_on_member(_MEMBER_DISPLAY, cond))
        elif field == "member.user_id":
            outer.append(_numeric_predicate(ScrapedMember.tg_user_id, cond))
        elif field == "member.status":
            outer.append(ScrapedMember.role == _str_value(cond))
        elif field == "member.message_count":
            exists_preds.append(
                _aggregate_exists(ScrapedMessage.sender_user_id, "count", cond, context)
            )
        elif field == "member.first_message_at":
            exists_preds.append(
                _aggregate_exists(ScrapedMessage.sender_user_id, "min", cond, context)
            )
        elif field == "member.last_message_at":
            exists_preds.append(
                _aggregate_exists(ScrapedMessage.sender_user_id, "max", cond, context)
            )
        elif field == "member.claim_status":
            exists_preds.append(_claim_exists(cond, context))
        return
    if field.startswith("group."):
        if field == "group.id":
            group_ids = _group_ids_for_value(cond)
            if group_ids:
                outer.append(ScrapedMember.tg_group_id.in_(group_ids))
        elif field == "group.name":
            subq = (
                select(ScrapedGroup.tg_group_id)
                .where(_text_predicate_on_group(cond))
                .where(ScrapedGroup.tg_group_id.isnot(None))
            )
            outer.append(ScrapedMember.tg_group_id.in_(subq))
        return
    # message.* leaves reached the outer query only via the same-message group
    # folding path; they are handled inside EXISTS building.
    if field.startswith("message."):
        exists_preds.append(_message_exists(cond, context))


# ── EXISTS builders ───────────────────────────────────────────────────────


def _build_exists_subquery(ep: ExistsPredicate, context: SearchContext):
    subq = select(literal_column("1")).where(*ep.where)
    if ep.aggregate and ep.having:
        subq = subq.group_by(ScrapedMessage.sender_user_id).having(*ep.having)
    return subq


def _aggregate_exists(
    column,
    agg_name: str,
    cond: Condition,
    context: SearchContext,
) -> ExistsPredicate:
    where: list[ColumnElement] = [ScrapedMessage.sender_user_id == ScrapedMember.tg_user_id]
    where.extend(_message_scope_clauses(context))
    agg = (
        func.count(column)
        if agg_name == "count"
        else (func.min(column) if agg_name == "min" else func.max(column))
    )
    having: list[ColumnElement] = []
    op = cond.operator
    value = cond.value
    if op == "between":
        having.append(agg >= value["from"])
        having.append(agg <= value["to"])
    else:
        having.append(_agg_comparison(agg, op, value))
    return ExistsPredicate(where=where, having=having, aggregate=True)


def _agg_comparison(agg, op: str, value: Any) -> ColumnElement:
    if op == "equals":
        return agg == value
    if op == "not_equals":
        return agg != value
    if op == "greater_than":
        return agg > value
    if op == "greater_than_or_equal":
        return agg >= value
    if op == "less_than":
        return agg < value
    if op == "less_than_or_equal":
        return agg <= value
    return agg == value


def _claim_exists(cond: Condition, context: SearchContext) -> ExistsPredicate:
    where: list[ColumnElement] = [
        MemberClaim.tg_user_id == ScrapedMember.tg_user_id,
        MemberClaim.status == "active",
    ]
    if context.tenant_id is not None:
        where.append(MemberClaim.tenant_id == context.tenant_id)
    value = _str_value(cond)
    negated = False
    if value == "unclaimed":
        negated = True
    elif value == "claimed":
        pass
    elif value == "claimed_by_me":
        if context.agent_id is not None:
            where.append(MemberClaim.agent_id == context.agent_id)
    elif value == "claimed_by_other" and context.agent_id is not None:
        where.append(MemberClaim.agent_id != context.agent_id)
    return ExistsPredicate(where=where, negated=negated)


# ── Sorting ───────────────────────────────────────────────────────────────


def _apply_sort(stmt: Select, *, sort: str, context: SearchContext) -> Select:
    if sort == SORT_USERNAME:
        return stmt.order_by(_MEMBER_USERNAME, ScrapedMember.tg_user_id)
    if sort == SORT_LAST_ACTIVE:
        subq = (
            select(
                ScrapedMessage.sender_user_id,
                func.max(ScrapedMessage.message_date).label("last_active"),
            )
            .where(ScrapedMessage.sender_user_id.isnot(None))
            .group_by(ScrapedMessage.sender_user_id)
            .subquery()
        )
        stmt = stmt.outerjoin(subq, ScrapedMember.tg_user_id == subq.c.sender_user_id)
        return stmt.order_by(subq.c.last_active.desc().nullslast(), ScrapedMember.tg_user_id)
    if sort == SORT_MESSAGE_COUNT:
        subq = (
            select(
                ScrapedMessage.sender_user_id,
                func.count(ScrapedMessage.id).label("message_count"),
            )
            .where(ScrapedMessage.sender_user_id.isnot(None))
            .group_by(ScrapedMessage.sender_user_id)
            .subquery()
        )
        stmt = stmt.outerjoin(subq, ScrapedMember.tg_user_id == subq.c.sender_user_id)
        return stmt.order_by(subq.c.message_count.desc().nullslast(), ScrapedMember.tg_user_id)
    # SORT_NEWEST_ACTIVITY (default)
    subq = (
        select(
            ScrapedMessage.sender_user_id,
            func.max(ScrapedMessage.message_date).label("last_active"),
        )
        .where(ScrapedMessage.sender_user_id.isnot(None))
        .group_by(ScrapedMessage.sender_user_id)
        .subquery()
    )
    stmt = stmt.outerjoin(subq, ScrapedMember.tg_user_id == subq.c.sender_user_id)
    return stmt.order_by(subq.c.last_active.desc().nullslast(), ScrapedMember.tg_user_id)


# ── Shared predicate helpers ──────────────────────────────────────────────


def _text_predicate_on_member(column, cond: Condition) -> ColumnElement:
    value = cond.value
    if isinstance(value, list):
        inner = [
            _text_predicate_on_member(
                column, Condition(field=cond.field, operator=cond.operator, value=kw)
            )
            for kw in value
        ]
        if cond.operator in ("not_contains", "not_equals"):
            return and_(*inner)
        return or_(*inner)
    op = cond.operator
    if op in ("contains", "not_contains"):
        pattern = f"%{_escape_like(value)}%"
        pred = column.ilike(pattern, escape=ESCAPE)
        return ~pred if op == "not_contains" else pred
    if op == "starts_with":
        return column.ilike(f"{_escape_like(value)}%", escape=ESCAPE)
    if op == "ends_with":
        return column.ilike(f"%{_escape_like(value)}", escape=ESCAPE)
    if op == "equals":
        return column == value.lower()
    if op == "not_equals":
        return column != value.lower()
    return column.ilike(f"%{_escape_like(value)}%", escape=ESCAPE)


def _text_predicate_on_group(cond: Condition) -> ColumnElement:
    value = cond.value
    op = cond.operator
    if op in ("contains", "not_contains"):
        pattern = f"%{_escape_like(value)}%"
        pred = _GROUP_TITLE.ilike(pattern, escape=ESCAPE)
        return ~pred if op == "not_contains" else pred
    if op == "starts_with":
        return _GROUP_TITLE.ilike(f"{_escape_like(value)}%", escape=ESCAPE)
    if op == "ends_with":
        return _GROUP_TITLE.ilike(f"%{_escape_like(value)}", escape=ESCAPE)
    if op == "equals":
        return _GROUP_TITLE == value.lower()
    if op == "not_equals":
        return _GROUP_TITLE != value.lower()
    return _GROUP_TITLE.ilike(f"%{_escape_like(value)}%", escape=ESCAPE)


def _numeric_predicate(column, cond: Condition) -> ColumnElement:
    value = cond.value
    op = cond.operator
    if op == "between":
        return and_(column >= value["from"], column <= value["to"])
    if op == "equals":
        return column == value
    if op == "not_equals":
        return column != value
    if op == "greater_than":
        return column > value
    if op == "greater_than_or_equal":
        return column >= value
    if op == "less_than":
        return column < value
    if op == "less_than_or_equal":
        return column <= value
    return column == value


def _date_predicates(column, cond: Condition) -> list[ColumnElement]:
    value = cond.value
    if cond.operator == "between":
        return [column >= value["from"], column <= value["to"]]
    if cond.operator == "before":
        return [column <= value]
    if cond.operator == "after":
        return [column >= value]
    return [column == value]


def _int_value(cond: Condition) -> int:
    return int(cond.value)


def _str_value(cond: Condition) -> str:
    return str(cond.value)


def _group_ids_for_value(cond: Condition) -> list[int]:
    value = cond.value
    if isinstance(value, list):
        return [int(v) for v in value]
    return [int(value)]


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
