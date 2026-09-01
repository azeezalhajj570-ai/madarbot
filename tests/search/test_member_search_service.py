"""MemberSearchService end-to-end tests.

Runs the full pipeline (scope → validate → normalize → plan → compile →
execute) against the SQLite in-memory test DB with a deterministic dataset.
SQLite lacks the tsvector/trigram machinery, so these tests exercise the
substring (ILIKE) path and the EXISTS semantics.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import (
    Agent,
    MemberClaim,
    ScrapedGroup,
    ScrapedMember,
    ScrapedMessage,
    Tenant,
    User,
)
from bot.search.exceptions import FilterValidationError
from bot.services.member_search_service import MemberSearchService

TG_GROUP = -1001234567


def cond(field: str, operator: str, value) -> dict:
    return {"type": "condition", "field": field, "operator": operator, "value": value}


def group(operator: str, *conditions) -> dict:
    return {"type": "group", "operator": operator, "conditions": list(conditions)}


async def first_agent_id(db: AsyncSession) -> int:
    return (await db.execute(select(Agent))).scalars().first().id


async def seed(db: AsyncSession) -> dict:
    now = datetime.now(UTC)
    user = User(tg_user_id=1001, username="owner", full_name="Owner", language_code="en")
    db.add(user)
    await db.flush()

    tenant = Tenant(name="Workspace", owner_user_id=user.id)
    db.add(tenant)
    await db.flush()

    agent = Agent(
        tenant_id=tenant.id,
        linked_by_user_id=1001,
        telegram_user_id=555,
        external_account_id="acct_1",
        status="active",
        auth_state="active",
    )
    db.add(agent)
    await db.flush()

    scraped_group = ScrapedGroup(tg_group_id=TG_GROUP, title="Crypto Chat", last_agent_id=agent.id)
    db.add(scraped_group)
    await db.flush()

    # ── Members ──────────────────────────────────────────────────────────
    members: dict[str, int] = {}
    for name, uid, role in [
        ("alice", 1001, "member"),  # crypto + investment, 3 msgs
        ("bob", 1002, "member"),  # crypto + scam, 2 msgs
        ("carol", 1003, "admin"),  # investment only, 1 msg
        ("dave", 1004, "member"),  # nothing matching, 0 msgs
    ]:
        m = ScrapedMember(
            scraped_group_id=scraped_group.id,
            tg_group_id=TG_GROUP,
            tg_user_id=uid,
            scraped_by_agent_id=agent.id,
            username=name,
            full_name=name.title(),
            role=role,
            is_bot=False,
        )
        db.add(m)
        members[name] = uid
    await db.flush()

    # ── Messages ─────────────────────────────────────────────────────────
    def msg(uid: int, text: str, days_ago: int):
        return ScrapedMessage(
            scraped_group_id=scraped_group.id,
            tg_group_id=TG_GROUP,
            message_id=abs(hash((uid, text, days_ago))) % 10**9,
            sender_user_id=uid,
            message_text=text,
            message_date=now - timedelta(days=days_ago),
            message_type="text",
        )

    msgs = [
        msg(members["alice"], "crypto is the future", 1),
        msg(members["alice"], "hello world", 2),
        msg(members["alice"], "investment strategy", 3),
        msg(members["bob"], "crypto scam warning", 1),
        msg(members["bob"], "random chat", 2),
        msg(members["carol"], "investment advice", 2),
    ]
    db.add_all(msgs)
    await db.flush()

    # ── Claim: bob is claimed by another agent ───────────────────────────
    other_agent = Agent(
        tenant_id=tenant.id,
        linked_by_user_id=1001,
        telegram_user_id=777,
        external_account_id="acct_2",
        status="active",
        auth_state="active",
    )
    db.add(other_agent)
    await db.flush()
    db.add(
        MemberClaim(
            tenant_id=tenant.id,
            scraped_group_id=scraped_group.id,
            tg_user_id=members["bob"],
            agent_id=other_agent.id,
            status="active",
            claimed_at=now,
            expires_at=now + timedelta(minutes=30),
        )
    )
    await db.commit()
    return {"agent_id": agent.id, "other_agent_id": other_agent.id, "tg_group_id": TG_GROUP}


async def search(db: AsyncSession, agent_id: int, filter_data: dict, **kwargs):
    return await MemberSearchService(db).search_members(
        actor_user_id=1001,
        agent_id=agent_id,
        filter_data=filter_data,
        **kwargs,
    )


@pytest.mark.asyncio
async def test_single_keyword(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("message.content", "contains", "crypto")),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001, 1002]  # alice + bob


@pytest.mark.asyncio
async def test_or_union(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group(
            "OR",
            cond("message.content", "contains", "crypto"),
            cond("message.content", "contains", "investment"),
        ),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001, 1002, 1003]  # alice, bob, carol


@pytest.mark.asyncio
async def test_and_member_level(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group(
            "AND",
            cond("message.content", "contains", "crypto"),
            cond("message.content", "contains", "investment"),
        ),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001]  # alice has separate messages for each term


@pytest.mark.asyncio
async def test_not_contains_excludes(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group(
            "AND",
            cond("message.content", "contains", "crypto"),
            cond("message.content", "not_contains", "scam"),
        ),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001]  # bob's crypto message also contains scam


@pytest.mark.asyncio
async def test_date_range(db_session):
    await seed(db_session)
    now = datetime.now(UTC)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("message.content", "contains", "crypto")),
        date_from=now - timedelta(days=2),
        date_to=now - timedelta(hours=12),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001, 1002]  # both crypto msgs within window


@pytest.mark.asyncio
async def test_message_count(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("member.message_count", "greater_than_or_equal", 3)),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1001]  # alice has 3 messages


@pytest.mark.asyncio
async def test_claim_status(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("member.claim_status", "equals", "claimed")),
    )
    ids = sorted(r["member_id"] for r in res["items"])
    assert ids == [1002]  # bob claimed by other agent


@pytest.mark.asyncio
async def test_group_scope_and_pagination(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("message.content", "contains", "crypto")),
        page_size=1,
        page=1,
    )
    assert len(res["items"]) == 1
    assert res["has_more"] is True
    res2 = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("message.content", "contains", "crypto")),
        page_size=1,
        page=2,
    )
    assert len(res2["items"]) == 1
    assert res2["has_more"] is False


@pytest.mark.asyncio
async def test_empty_text_rejected(db_session):
    await seed(db_session)
    with pytest.raises(FilterValidationError):
        await search(
            db_session,
            await first_agent_id(db_session),
            group("AND", cond("message.content", "contains", "")),
        )


@pytest.mark.asyncio
async def test_invalid_filter_rejected(db_session):
    await seed(db_session)
    with pytest.raises(FilterValidationError):
        await search(
            db_session,
            await first_agent_id(db_session),
            group("AND", cond("member.banana", "contains", "x")),
        )


@pytest.mark.asyncio
async def test_include_total(db_session):
    await seed(db_session)
    res = await search(
        db_session,
        await first_agent_id(db_session),
        group("AND", cond("message.content", "contains", "crypto")),
        include_total=True,
    )
    assert res["total"] == 2
