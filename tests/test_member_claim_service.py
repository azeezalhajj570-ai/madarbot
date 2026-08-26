"""Tests for the member-claiming service (feature 021).

Covers FR-010/FR-011/FR-012:
- claim_members creates claims and rejects already-claimed members.
- Workspace isolation: the same member can be claimed in two tenants.
- release_claims is agent + tenant scoped.
- expire_stale_claims picks up expired claims.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from bot.db.models import (
    Agent,
    Group,
    MemberClaim,
    ScrapedGroup,
    ScrapedMember,
    Tenant,
    TenantMembership,
    User,
)
from bot.services.member_claim_service import (
    claim_members,
    expire_stale_claims,
    get_claim_status_for_members,
    release_claims,
)


async def _seed_workspace(
    db_session,
    *,
    owner_tg_id: int,
    tenant_id: int | None = None,
    agent_tg_id: int,
    group_tg_id: int,
    member_tg_ids: list[int],
) -> dict[str, int]:
    """Seed a tenant-scoped workspace with one agent, one scraped group and members."""
    user = User(
        tg_user_id=owner_tg_id,
        username=f"owner{owner_tg_id}",
        full_name="Owner",
    )
    db_session.add(user)
    await db_session.flush()

    tenant = Tenant(owner_user_id=user.id, name=f"Workspace {owner_tg_id}")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TenantMembership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    await db_session.flush()
    if tenant_id is not None:
        tenant.id = tenant_id
        await db_session.flush()

    group = Group(
        tg_group_id=group_tg_id,
        title=f"Group {group_tg_id}",
        owner_user_id=user.id,
        is_active=True,
    )
    db_session.add(group)
    await db_session.flush()

    agent = Agent(
        group_id=group.id,
        telegram_user_id=agent_tg_id,
        tenant_id=tenant.id,
        linked_by_user_id=user.tg_user_id,
        external_account_id=f"agent-{agent_tg_id}",
        status="active",
        auth_state="active",
        session_string="session:x",
        details={},
    )
    db_session.add(agent)
    await db_session.flush()

    scraped_group = ScrapedGroup(
        tg_group_id=group_tg_id,
        title=group.title,
        group_type="supergroup",
        last_agent_id=agent.id,
        member_count=len(member_tg_ids),
    )
    db_session.add(scraped_group)
    await db_session.flush()

    for mid in member_tg_ids:
        db_session.add(
            ScrapedMember(
                scraped_group_id=scraped_group.id,
                tg_group_id=group_tg_id,
                tg_user_id=mid,
                username=f"member{mid}",
                full_name=f"Member {mid}",
                role="member",
            )
        )
    await db_session.commit()
    return {"agent_id": agent.id, "scraped_group_id": scraped_group.id, "tenant_id": tenant.id}


@pytest.mark.asyncio
async def test_claim_members_claims_new_members(db_session) -> None:
    ids = await _seed_workspace(
        db_session,
        owner_tg_id=9001,
        agent_tg_id=9101,
        group_tg_id=-1009001,
        member_tg_ids=[1, 2, 3],
    )
    result = await claim_members(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=ids["agent_id"],
        scraped_group_id=ids["scraped_group_id"],
        tg_user_ids=[1, 2, 3],
    )
    await db_session.commit()

    assert sorted(result.claimed) == [1, 2, 3]
    assert result.conflicts == []


@pytest.mark.asyncio
async def test_claim_members_rejects_already_claimed_member(db_session) -> None:
    """FR-012: an already-claimed member is rejected, never silently reassigned."""
    ids = await _seed_workspace(
        db_session,
        owner_tg_id=9002,
        agent_tg_id=9102,
        group_tg_id=-1009002,
        member_tg_ids=[1, 2],
    )
    # Agent A claims member 1.
    await claim_members(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=ids["agent_id"],
        scraped_group_id=ids["scraped_group_id"],
        tg_user_ids=[1],
    )
    await db_session.commit()

    # Agent B (same workspace) tries to claim members 1 and 2.
    agent_b = Agent(
        group_id=1,
        telegram_user_id=9202,
        tenant_id=ids["tenant_id"],
        linked_by_user_id=9002,
        external_account_id="agent-b",
        status="active",
        auth_state="active",
        session_string="session:b",
        details={},
    )
    db_session.add(agent_b)
    await db_session.flush()
    await db_session.commit()

    result = await claim_members(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=agent_b.id,
        scraped_group_id=ids["scraped_group_id"],
        tg_user_ids=[1, 2],
    )
    await db_session.commit()

    assert result.claimed == [2]
    assert len(result.conflicts) == 1
    assert result.conflicts[0].tg_user_id == 1
    assert result.conflicts[0].claimed_by_agent_id == ids["agent_id"]

    # Member 1 is still claimed by Agent A.
    claims = await get_claim_status_for_members(
        db_session,
        tenant_id=ids["tenant_id"],
        tg_user_ids=[1],
        current_agent_id=agent_b.id,
    )
    assert claims[1] is not None
    assert claims[1].agent_id == ids["agent_id"]
    assert claims[1].is_own is False


@pytest.mark.asyncio
async def test_claim_members_workspace_isolation(db_session) -> None:
    """FR-011: the same member can be claimed in two different workspaces."""
    ids_a = await _seed_workspace(
        db_session,
        owner_tg_id=9003,
        agent_tg_id=9103,
        group_tg_id=-1009003,
        member_tg_ids=[1],
    )
    await claim_members(
        db_session,
        tenant_id=ids_a["tenant_id"],
        agent_id=ids_a["agent_id"],
        scraped_group_id=ids_a["scraped_group_id"],
        tg_user_ids=[1],
    )
    await db_session.commit()

    ids_b = await _seed_workspace(
        db_session,
        owner_tg_id=9004,
        agent_tg_id=9104,
        group_tg_id=-1009004,
        member_tg_ids=[1],
    )
    result_b = await claim_members(
        db_session,
        tenant_id=ids_b["tenant_id"],
        agent_id=ids_b["agent_id"],
        scraped_group_id=ids_b["scraped_group_id"],
        tg_user_ids=[1],
    )
    await db_session.commit()

    assert result_b.claimed == [1]
    assert result_b.conflicts == []


@pytest.mark.asyncio
async def test_release_claims_is_agent_and_tenant_scoped(db_session) -> None:
    """FR-011: an agent cannot release another agent's claims."""
    ids = await _seed_workspace(
        db_session,
        owner_tg_id=9005,
        agent_tg_id=9105,
        group_tg_id=-1009005,
        member_tg_ids=[1],
    )
    await claim_members(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=ids["agent_id"],
        scraped_group_id=ids["scraped_group_id"],
        tg_user_ids=[1],
    )
    await db_session.commit()

    claim = (
        await db_session.execute(
            select(MemberClaim).where(
                MemberClaim.tg_user_id == 1, MemberClaim.status == "active"
            )
        )
    ).scalar_one()

    # Another agent in the same tenant cannot release it.
    released = await release_claims(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=99999,
        claim_ids=[claim.id],
    )
    await db_session.commit()
    assert released == 0

    # A wrong tenant cannot release it either.
    released = await release_claims(
        db_session,
        tenant_id=99,
        agent_id=ids["agent_id"],
        claim_ids=[claim.id],
    )
    await db_session.commit()
    assert released == 0

    # The owning agent can.
    released = await release_claims(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=ids["agent_id"],
        claim_ids=[claim.id],
    )
    await db_session.commit()
    assert released == 1


@pytest.mark.asyncio
async def test_expire_stale_claims(db_session) -> None:
    """Expired claims are picked up by the reconciler."""
    ids = await _seed_workspace(
        db_session,
        owner_tg_id=9006,
        agent_tg_id=9106,
        group_tg_id=-1009006,
        member_tg_ids=[1],
    )
    await claim_members(
        db_session,
        tenant_id=ids["tenant_id"],
        agent_id=ids["agent_id"],
        scraped_group_id=ids["scraped_group_id"],
        tg_user_ids=[1],
        ttl_minutes=30,
    )
    await db_session.commit()

    # Backdate the claim so it is already expired.
    claim = (
        await db_session.execute(
            select(MemberClaim).where(
                MemberClaim.tg_user_id == 1, MemberClaim.status == "active"
            )
        )
    ).scalar_one()
    claim.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    await db_session.commit()

    expired = await expire_stale_claims(db_session)
    await db_session.commit()

    assert expired >= 1
    claims = await get_claim_status_for_members(
        db_session,
        tenant_id=ids["tenant_id"],
        tg_user_ids=[1],
        current_agent_id=ids["agent_id"],
    )
    assert claims[1] is None  # no longer active
