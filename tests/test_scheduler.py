from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from bot.agents.agent_job_service import AgentJobService
from bot.agents.jobs import (
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    JOB_STATUS_ABORTED,
    JOB_STATUS_SCHEDULED,
)
from bot.db.models import Agent, AgentJob, Group, GroupAdminRole, User


pytestmark = pytest.mark.asyncio


async def _create_user_group_agent(
    db_session,
    user_tg_id=8105,
    group_tg_id=-1008105,
    linked_by_user_id=None,
) -> tuple[User, Group, Agent]:
    user = User(
        tg_user_id=user_tg_id, username="owner_sched", full_name="Sched Owner", language_code="en"
    )
    db_session.add(user)
    await db_session.flush()

    group = Group(
        tg_group_id=group_tg_id, title="Sched Group", owner_user_id=user.id, is_active=True
    )
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))

    agent = Agent(
        group_id=group.id,
        linked_by_user_id=linked_by_user_id,
        telegram_user_id=9105 + user_tg_id % 100,
        external_account_id=f"sched-agent-{user_tg_id}",
        status="active",
        auth_state="active",
        session_string="session:sched",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()
    return user, group, agent


async def _create_job(
    db_session,
    agent: Agent,
    scheduled_at: datetime | None = None,
    job_type: str = "test_job",
    payload: dict | None = None,
) -> AgentJob:
    job = AgentJob(
        agent_id=agent.id,
        job_type=job_type,
        job_payload=payload or {},
        status=JOB_STATUS_SCHEDULED if scheduled_at else "pending",
        scheduled_at=scheduled_at,
    )
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


def _mock_settings(scheduler_enabled: bool = True) -> MagicMock:
    s = MagicMock()
    s.scheduler_enabled = scheduler_enabled
    s.scheduler_poll_interval = 30
    return s


# ─── Model: scheduled_at column ────────────────────────────────────────────


async def test_agent_job_model_supports_scheduled_at(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)
    future = datetime.now(timezone.utc) + timedelta(hours=2)

    job = await _create_job(db_session, agent, scheduled_at=future)

    stored = (await db_session.execute(select(AgentJob).where(AgentJob.id == job.id))).scalar_one()
    assert stored.status == JOB_STATUS_SCHEDULED
    assert stored.scheduled_at is not None
    diff = (
        (stored.scheduled_at.replace(tzinfo=timezone.utc) - future).total_seconds()
        if stored.scheduled_at.tzinfo is None
        else (stored.scheduled_at - future).total_seconds()
    )
    assert abs(diff) < 1


async def test_agent_job_model_scheduled_at_is_nullable(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)

    job = await _create_job(db_session, agent, scheduled_at=None)

    stored = (await db_session.execute(select(AgentJob).where(AgentJob.id == job.id))).scalar_one()
    assert stored.scheduled_at is None
    assert stored.status == "pending"


# ─── AgentJobService.create_job with scheduled_at ─────────────────────────


async def test_create_job_with_scheduled_at_sets_status_scheduled(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)
    future = datetime.now(timezone.utc) + timedelta(hours=1)

    service = AgentJobService(db_session)
    job = await service.create_job(
        actor_user_id=user.tg_user_id,
        agent_id=agent.id,
        job_type="sync",
        job_payload={"action": "refresh"},
        scheduled_at=future,
    )

    assert job.status == JOB_STATUS_SCHEDULED
    assert job.scheduled_at is not None
    diff = (
        (job.scheduled_at.replace(tzinfo=timezone.utc) - future).total_seconds()
        if job.scheduled_at.tzinfo is None
        else (job.scheduled_at - future).total_seconds()
    )
    assert abs(diff) < 1

    stored = (await db_session.execute(select(AgentJob).where(AgentJob.id == job.id))).scalar_one()
    assert stored.status == JOB_STATUS_SCHEDULED


async def test_create_job_without_scheduled_at_stays_pending(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)

    service = AgentJobService(db_session)
    job = await service.create_job(
        actor_user_id=user.tg_user_id,
        agent_id=agent.id,
        job_type="sync",
        job_payload={"action": "refresh"},
        scheduled_at=None,
    )

    assert job.status == "pending"
    assert job.scheduled_at is None


async def test_create_job_with_scheduled_at_skips_rate_limit_preflight(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    preflight_mock = AsyncMock(side_effect=ValueError("should not be called"))
    monkeypatch.setattr(
        "bot.agents.agent_job_service.AgentJobService._validate_broadcast_preflight",
        preflight_mock,
    )
    monkeypatch.setattr(
        "bot.agents.agent_job_service.AgentJobService._validate_broadcast_rate_limits",
        AsyncMock(side_effect=ValueError("should not be called")),
    )

    user, group, agent = await _create_user_group_agent(db_session)
    future = datetime.now(timezone.utc) + timedelta(hours=1)

    service = AgentJobService(db_session)
    job = await service.create_job(
        actor_user_id=user.tg_user_id,
        agent_id=agent.id,
        job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
        job_payload={
            "source_group_id": str(group.tg_group_id),
            "message": "Hello from scheduled",
            "threshold": "25",
            "interval_seconds": "1.5",
        },
        scheduled_at=future,
    )

    assert job.status == JOB_STATUS_SCHEDULED
    preflight_mock.assert_not_called()


async def test_create_job_immediate_still_validates_rate_limits(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    preflight_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "bot.agents.agent_job_service.AgentJobService._validate_broadcast_preflight",
        preflight_mock,
    )

    user, group, agent = await _create_user_group_agent(db_session)

    service = AgentJobService(db_session)
    await service.create_job(
        actor_user_id=user.tg_user_id,
        agent_id=agent.id,
        job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
        job_payload={
            "source_group_id": str(group.tg_group_id),
            "message": "Hello now",
            "threshold": "25",
            "interval_seconds": "1.5",
        },
        scheduled_at=None,
    )

    preflight_mock.assert_called_once()


# ─── Cancel scheduled job ──────────────────────────────────────────────────


async def test_cancel_scheduled_job_succeeds(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)
    agent.linked_by_user_id = user.tg_user_id
    await db_session.commit()
    future = datetime.now(timezone.utc) + timedelta(hours=2)

    job = await _create_job(db_session, agent, scheduled_at=future)
    assert job.status == JOB_STATUS_SCHEDULED

    job.status = JOB_STATUS_ABORTED
    await db_session.commit()

    stored = (await db_session.execute(select(AgentJob).where(AgentJob.id == job.id))).scalar_one()
    assert stored.status == JOB_STATUS_ABORTED


async def test_cancel_scheduled_job_requires_valid_owner(db_session) -> None:
    user1, group1, agent1 = await _create_user_group_agent(
        db_session,
        user_tg_id=8106,
        group_tg_id=-1008106,
        linked_by_user_id=8106,
    )

    future = datetime.now(timezone.utc) + timedelta(hours=2)
    job = await _create_job(db_session, agent1, scheduled_at=future)

    service = AgentJobService(db_session)
    with pytest.raises(PermissionError, match="do not own"):
        await service.update_job_status(
            actor_user_id=999999,
            job_id=job.id,
            status=JOB_STATUS_ABORTED,
        )


# ─── Scheduler loop: atomic claim and dispatch ─────────────────────────────


async def test_scheduler_dispatches_due_scheduled_jobs(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)

    dispatch_mock = AsyncMock()
    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", dispatch_mock)

    user, group, agent = await _create_user_group_agent(db_session)

    due_job = await _create_job(
        db_session,
        agent,
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    future_job = await _create_job(
        db_session,
        agent,
        scheduled_at=datetime.now(timezone.utc) + timedelta(hours=5),
    )

    await scheduler_tick()

    dispatch_mock.assert_called_once_with(due_job.id)

    due_stored = (
        await db_session.execute(select(AgentJob).where(AgentJob.id == due_job.id))
    ).scalar_one()
    assert due_stored.status == "pending"

    future_stored = (
        await db_session.execute(select(AgentJob).where(AgentJob.id == future_job.id))
    ).scalar_one()
    assert future_stored.status == JOB_STATUS_SCHEDULED


async def test_scheduler_only_dispatches_once_per_job(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)
    dispatched = []

    async def tracking_dispatch(job_id: int) -> None:
        dispatched.append(job_id)

    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", tracking_dispatch)

    user, group, agent = await _create_user_group_agent(db_session)

    job = await _create_job(
        db_session,
        agent,
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    await scheduler_tick()
    assert len(dispatched) == 1
    assert dispatched[0] == job.id

    dispatched.clear()
    await scheduler_tick()
    assert len(dispatched) == 0, "should not dispatch already-pending job"


async def test_scheduler_does_not_dispatch_future_jobs(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)
    dispatch_mock = AsyncMock()
    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", dispatch_mock)

    user, group, agent = await _create_user_group_agent(db_session)

    await _create_job(
        db_session,
        agent,
        scheduled_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )

    await scheduler_tick()
    dispatch_mock.assert_not_called()


async def test_scheduler_does_not_dispatch_non_scheduled_jobs(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)
    dispatch_mock = AsyncMock()
    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", dispatch_mock)

    user, group, agent = await _create_user_group_agent(db_session)

    job = AgentJob(
        agent_id=agent.id,
        job_type="test",
        job_payload={},
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    await scheduler_tick()
    dispatch_mock.assert_not_called()


async def test_scheduler_dispatches_multiple_due_jobs(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)
    dispatched = []

    async def tracking_dispatch(job_id: int) -> None:
        dispatched.append(job_id)

    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", tracking_dispatch)

    user, group, agent = await _create_user_group_agent(db_session)

    past = datetime.now(timezone.utc) - timedelta(hours=1)
    job1 = await _create_job(db_session, agent, scheduled_at=past)
    job2 = await _create_job(db_session, agent, scheduled_at=past)

    await scheduler_tick()

    assert len(dispatched) == 2
    assert job1.id in dispatched
    assert job2.id in dispatched


async def test_scheduler_handles_dispatch_failure_gracefully(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(True))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)

    call_count = 0

    async def failing_dispatch(job_id: int) -> None:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("dispatch failed")

    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", failing_dispatch)

    user, group, agent = await _create_user_group_agent(db_session)

    past = datetime.now(timezone.utc) - timedelta(hours=1)
    await _create_job(db_session, agent, scheduled_at=past)
    await _create_job(db_session, agent, scheduled_at=past)

    await scheduler_tick()

    assert call_count == 2, "should attempt both dispatches even if first fails"


# ─── Scheduler loop: disabled when config flag is off ──────────────────────


async def test_scheduler_does_nothing_when_disabled(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bot.services.scheduler import _tick as scheduler_tick

    monkeypatch.setattr("bot.services.scheduler.get_settings", lambda: _mock_settings(False))
    monkeypatch.setattr("bot.services.scheduler.SessionLocal", lambda: db_session)
    dispatch_mock = AsyncMock()
    monkeypatch.setattr("bot.services.scheduler.dispatch_agent_job", dispatch_mock)

    user, group, agent = await _create_user_group_agent(db_session)
    await _create_job(
        db_session,
        agent,
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    await scheduler_tick()
    dispatch_mock.assert_not_called()


# ─── Groups mode: scheduled broadcast ──────────────────────────────────────


async def test_create_scheduled_groups_broadcast_job(db_session) -> None:
    user, group, agent = await _create_user_group_agent(db_session)
    future = datetime.now(timezone.utc) + timedelta(hours=2)

    service = AgentJobService(db_session)
    job = await service.create_job(
        actor_user_id=user.tg_user_id,
        agent_id=agent.id,
        job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
        job_payload={
            "target_type": "groups",
            "target_group_ids": [-1002001, -1002002],
            "message": "Scheduled broadcast to groups",
            "threshold": "10",
            "interval_seconds": "2",
        },
        scheduled_at=future,
    )

    assert job.status == JOB_STATUS_SCHEDULED
    assert job.job_payload["target_type"] == "groups"
    assert len(job.job_payload["target_group_ids"]) == 2

    stored = (await db_session.execute(select(AgentJob).where(AgentJob.id == job.id))).scalar_one()
    assert stored.status == JOB_STATUS_SCHEDULED
    assert stored.job_payload["message"] == "Scheduled broadcast to groups"
