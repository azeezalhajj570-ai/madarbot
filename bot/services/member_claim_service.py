"""Service for managing member claims in parallel bulk operations.

Provides atomic claim acquisition, release, and expiration using
PostgreSQL's partial unique index for concurrency safety.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Sequence

import structlog
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models.member_claim import MemberClaim

logger = structlog.get_logger(__name__)

# Default claim duration in minutes
DEFAULT_CLAIM_TTL_MINUTES = 30


@dataclass
class ClaimConflict:
    """A member that could not be claimed due to an existing active claim."""

    scraped_member_id: int
    claimed_by_agent_id: int
    claimed_by_agent_name: str | None
    expires_at: datetime


@dataclass
class ClaimResult:
    """Result of a bulk claim operation."""

    claimed: list[int]  # successfully claimed member IDs
    conflicts: list[ClaimConflict]  # members already claimed by another agent


@dataclass
class ActiveClaimInfo:
    """Information about an active claim for display."""

    claim_id: int
    scraped_member_id: int
    agent_id: int
    agent_name: str | None
    status: str
    claimed_at: datetime
    expires_at: datetime
    is_own: bool  # True if claimed by the current agent


async def claim_members(
    session: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    scraped_group_id: int,
    member_ids: Sequence[int],
    agent_job_id: int | None = None,
    ttl_minutes: int = DEFAULT_CLAIM_TTL_MINUTES,
) -> ClaimResult:
    """Atomically claim members for a bulk operation.

    Uses INSERT ... ON CONFLICT DO NOTHING with the partial unique index
    to guarantee one active claim per (tenant, member) at the database level.

    Returns ClaimResult with successfully claimed members and conflicts.
    """
    if not member_ids:
        return ClaimResult(claimed=[], conflicts=[])

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=ttl_minutes)

    # Build insert rows
    rows = [
        {
            "tenant_id": tenant_id,
            "scraped_group_id": scraped_group_id,
            "scraped_member_id": member_id,
            "agent_id": agent_id,
            "agent_job_id": agent_job_id,
            "status": "active",
            "claimed_at": now,
            "expires_at": expires_at,
            "created_at": now,
            "updated_at": now,
        }
        for member_id in member_ids
    ]

    # Atomic bulk insert with conflict detection
    stmt = pg_insert(MemberClaim).values(rows)
    stmt = stmt.on_conflict_do_nothing(
        index_elements=["tenant_id", "scraped_member_id"],
        index_where="status = 'active'",
    )
    stmt = stmt.returning(MemberClaim.scraped_member_id)

    result = await session.execute(stmt)
    claimed_ids = [row[0] for row in result.fetchall()]
    await session.flush()

    # Find conflicts: members that were not claimed
    claimed_set = set(claimed_ids)
    conflict_member_ids = [m for m in member_ids if m not in claimed_set]

    conflicts: list[ClaimConflict] = []
    if conflict_member_ids:
        # Fetch conflict details from existing active claims
        conflict_stmt = (
            select(MemberClaim)
            .where(
                and_(
                    MemberClaim.tenant_id == tenant_id,
                    MemberClaim.scraped_member_id.in_(conflict_member_ids),
                    MemberClaim.status == "active",
                )
            )
        )
        conflict_result = await session.execute(conflict_stmt)
        existing_claims = conflict_result.scalars().all()

        for claim in existing_claims:
            conflicts.append(
                ClaimConflict(
                    scraped_member_id=claim.scraped_member_id,
                    claimed_by_agent_id=claim.agent_id,
                    claimed_by_agent_name=None,  # resolved later if needed
                    expires_at=claim.expires_at,
                )
            )

    logger.info(
        "bulk_claim_completed",
        tenant_id=tenant_id,
        agent_id=agent_id,
        scraped_group_id=scraped_group_id,
        requested=len(member_ids),
        claimed=len(claimed_ids),
        conflicts=len(conflicts),
    )

    return ClaimResult(claimed=claimed_ids, conflicts=conflicts)


async def release_claims(
    session: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    claim_ids: Sequence[int],
) -> int:
    """Release specific claims owned by the agent.

    Returns the number of claims released.
    """
    if not claim_ids:
        return 0

    now = datetime.now(timezone.utc)
    stmt = (
        update(MemberClaim)
        .where(
            and_(
                MemberClaim.id.in_(claim_ids),
                MemberClaim.tenant_id == tenant_id,
                MemberClaim.agent_id == agent_id,
                MemberClaim.status == "active",
            )
        )
        .values(status="released", released_at=now, updated_at=now)
    )
    result = await session.execute(stmt)
    await session.flush()

    count = result.rowcount
    if count > 0:
        logger.info(
            "claims_released",
            tenant_id=tenant_id,
            agent_id=agent_id,
            count=count,
        )
    return count


async def release_operation_claims(
    session: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    agent_job_id: int,
) -> int:
    """Release all claims associated with an operation (agent_job).

    Returns the number of claims released.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(MemberClaim)
        .where(
            and_(
                MemberClaim.agent_job_id == agent_job_id,
                MemberClaim.tenant_id == tenant_id,
                MemberClaim.agent_id == agent_id,
                MemberClaim.status == "active",
            )
        )
        .values(status="released", released_at=now, updated_at=now)
    )
    result = await session.execute(stmt)
    await session.flush()

    count = result.rowcount
    if count > 0:
        logger.info(
            "operation_claims_released",
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_job_id=agent_job_id,
            count=count,
        )
    return count


async def expire_stale_claims(
    session: AsyncSession,
    *,
    batch_size: int = 500,
) -> int:
    """Expire claims that have passed their expiration time.

    Returns the number of claims expired.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(MemberClaim)
        .where(
            and_(
                MemberClaim.status == "active",
                MemberClaim.expires_at < now,
            )
        )
        .values(status="expired", released_at=now, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    result = await session.execute(stmt)
    await session.flush()

    count = result.rowcount
    if count > 0:
        logger.info("stale_claims_expired", count=count)
    return count


async def get_active_claims_for_group(
    session: AsyncSession,
    *,
    tenant_id: int,
    scraped_group_id: int,
    current_agent_id: int | None = None,
) -> list[ActiveClaimInfo]:
    """Get all active claims for a source group.

    Returns claims with ownership info relative to the current agent.
    """
    stmt = (
        select(MemberClaim)
        .where(
            and_(
                MemberClaim.tenant_id == tenant_id,
                MemberClaim.scraped_group_id == scraped_group_id,
                MemberClaim.status == "active",
            )
        )
        .order_by(MemberClaim.claimed_at.desc())
    )
    result = await session.execute(stmt)
    claims = result.scalars().all()

    return [
        ActiveClaimInfo(
            claim_id=claim.id,
            scraped_member_id=claim.scraped_member_id,
            agent_id=claim.agent_id,
            agent_name=None,  # resolved by caller if needed
            status=claim.status,
            claimed_at=claim.claimed_at,
            expires_at=claim.expires_at,
            is_own=(current_agent_id is not None and claim.agent_id == current_agent_id),
        )
        for claim in claims
    ]


async def get_claim_status_for_members(
    session: AsyncSession,
    *,
    tenant_id: int,
    member_ids: Sequence[int],
    current_agent_id: int | None = None,
) -> dict[int, ActiveClaimInfo | None]:
    """Get claim status for a list of members.

    Returns a dict mapping member_id -> ActiveClaimInfo (or None if unclaimed).
    """
    if not member_ids:
        return {}

    stmt = (
        select(MemberClaim)
        .where(
            and_(
                MemberClaim.tenant_id == tenant_id,
                MemberClaim.scraped_member_id.in_(member_ids),
                MemberClaim.status == "active",
            )
        )
    )
    result = await session.execute(stmt)
    claims = result.scalars().all()

    # Build lookup: member_id -> claim
    claim_map: dict[int, ActiveClaimInfo] = {}
    for claim in claims:
        claim_map[claim.scraped_member_id] = ActiveClaimInfo(
            claim_id=claim.id,
            scraped_member_id=claim.scraped_member_id,
            agent_id=claim.agent_id,
            agent_name=None,
            status=claim.status,
            claimed_at=claim.claimed_at,
            expires_at=claim.expires_at,
            is_own=(current_agent_id is not None and claim.agent_id == current_agent_id),
        )

    # Return results for all requested members
    return {
        mid: claim_map.get(mid) for mid in member_ids
    }


async def validate_claim_ownership(
    session: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
    claim_id: int,
) -> bool:
    """Verify that a claim belongs to the specified agent and is active."""
    stmt = select(MemberClaim).where(
        and_(
            MemberClaim.id == claim_id,
            MemberClaim.tenant_id == tenant_id,
            MemberClaim.agent_id == agent_id,
            MemberClaim.status == "active",
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def release_all_agent_claims(
    session: AsyncSession,
    *,
    tenant_id: int,
    agent_id: int,
) -> int:
    """Release all active claims for an agent in a workspace.

    Useful for cleanup when an agent disconnects or operation is cancelled.
    Returns the number of claims released.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(MemberClaim)
        .where(
            and_(
                MemberClaim.tenant_id == tenant_id,
                MemberClaim.agent_id == agent_id,
                MemberClaim.status == "active",
            )
        )
        .values(status="released", released_at=now, updated_at=now)
    )
    result = await session.execute(stmt)
    await session.flush()

    count = result.rowcount
    if count > 0:
        logger.info(
            "all_agent_claims_released",
            tenant_id=tenant_id,
            agent_id=agent_id,
            count=count,
        )
    return count
