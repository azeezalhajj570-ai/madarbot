"""Service for verifying whether invited members joined a group."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models.member_operation import MemberOperation

logger = structlog.get_logger(__name__)


async def verify_member_join_status(
    client,
    session: AsyncSession,
    tg_group_id: int,
    tg_user_id: int,
) -> str | None:
    """Check if a user is now a member of the group.

    Returns 'joined' if confirmed, 'not_joined' if confirmed absent,
    None if indeterminate.
    """
    try:
        from bot.agents.group_membership import is_user_in_group
        from telethon.tl.types import InputUser

        user_peer = await client.get_entity(tg_user_id)
        group_entity = await client.get_entity(tg_group_id)
        result = await is_user_in_group(client, group_entity, user_peer)
        if result is True:
            return "joined"
        if result is False:
            return "not_joined"
        return None
    except Exception:
        logger.bind(tg_group_id=tg_group_id, tg_user_id=tg_user_id).exception(
            "member_verification_check_failed"
        )
        return None


async def verify_invitation_members(
    client,
    session: AsyncSession,
    tg_group_id: int,
    agent_id: int,
) -> dict[str, Any]:
    """Verify all pending invitation members for a group.

    Returns stats about verification results.
    """
    rows = (
        await session.execute(
            select(MemberOperation).where(
                MemberOperation.tg_group_id == tg_group_id,
                MemberOperation.agent_id == agent_id,
                MemberOperation.status == "sent",
            )
        )
    ).scalars().all()

    joined_count = 0
    not_joined_count = 0
    failed_count = 0

    for op in rows:
        status = await verify_member_join_status(client, session, op.tg_group_id, op.tg_user_id)
        now = datetime.now(timezone.utc)
        op.verified_at = now

        if status == "joined":
            op.status = "joined"
            op.joined_at = now
            joined_count += 1
        elif status == "not_joined":
            not_joined_count += 1
        else:
            failed_count += 1

    await session.commit()

    return {
        "total_verified": len(rows),
        "joined": joined_count,
        "not_joined": not_joined_count,
        "indeterminate": failed_count,
    }


async def verify_all_pending_invitations(
    client,
    session: AsyncSession,
    agent_id: int,
) -> dict[str, Any]:
    """Verify all pending invitations across all groups for an agent."""
    rows = (
        await session.execute(
            select(MemberOperation.tg_group_id).where(
                MemberOperation.agent_id == agent_id,
                MemberOperation.status == "sent",
            ).distinct()
        )
    ).all()

    total_joined = 0
    total_not_joined = 0
    total_failed = 0
    groups_checked = 0

    for (tg_group_id,) in rows:
        result = await verify_invitation_members(client, session, tg_group_id, agent_id)
        total_joined += result["joined"]
        total_not_joined += result["not_joined"]
        total_failed += result["indeterminate"]
        groups_checked += 1

    return {
        "groups_checked": groups_checked,
        "total_joined": total_joined,
        "total_not_joined": total_not_joined,
        "total_indeterminate": total_failed,
    }
