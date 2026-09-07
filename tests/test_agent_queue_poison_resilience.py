"""Regression tests for the agent-queue poison-retry fix.

Covers: dispatch refusal of terminal jobs, reconcile skipping jobs that have a
pending delayed resume (_resume_at), and the bounded manual reschedule helper.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from bot.agents.jobs import (
    JOB_STATUS_DISPATCH_STALE,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_QUEUED,
)
from bot.db.models import Agent, AgentJob


def _make_agent(db_session, *, external_id: str = "queue-poison", tg_id: int = 777001) -> Agent:
    agent = Agent(
        group_id=None,
        telegram_user_id=tg_id,
        linked_by_user_id=None,
        external_account_id=external_id,
        auth_state="active",
        session_string="session",
        status="active",
    )
    db_session.add(agent)
    return agent


def _make_job(
    db_session, agent: Agent, *, job_type: str = "member_add", status: str = "queued"
) -> AgentJob:
    job = AgentJob(
        agent_id=agent.id,
        job_type=job_type,
        status=status,
        job_payload={"target_tg_group_id": -100123, "user_ids": [1, 2, 3]},
    )
    db_session.add(job)
    return job


class _FakeBroker:
    def __init__(self, sink: list[str]) -> None:
        self._sink = sink

    def enqueue(self, message) -> None:
        self._sink.append(message.actor_name)


class TestResumeAtHelpers:
    def test_parse_resume_at(self):
        from bot.agents.dispatch import RESUME_AT_KEY, _has_pending_resume, _job_resume_at

        now = datetime.now(timezone.utc)
        payload = {RESUME_AT_KEY: (now + timedelta(hours=6)).isoformat()}
        assert _job_resume_at(payload) is not None
        assert _has_pending_resume(payload, now) is True

    def test_past_resume_at_not_pending(self):
        from bot.agents.dispatch import RESUME_AT_KEY, _has_pending_resume

        now = datetime.now(timezone.utc)
        payload = {RESUME_AT_KEY: (now - timedelta(minutes=1)).isoformat()}
        assert _has_pending_resume(payload, now) is False

    def test_missing_resume_at_not_pending(self):
        from bot.agents.dispatch import _has_pending_resume

        assert _has_pending_resume({}, datetime.now(timezone.utc)) is False

    def test_naive_resume_at_interpreted_utc(self):
        from bot.agents.dispatch import _job_resume_at

        payload = {"_resume_at": "2026-09-03T12:00:00"}
        parsed = _job_resume_at(payload)
        assert parsed is not None
        assert parsed.tzinfo is not None


class TestRescheduleCap:
    def test_cap_exceeded_returns_false(self, monkeypatch: pytest.MonkeyPatch):
        from bot.agents import worker as worker_mod

        sent: list[dict] = []
        monkeypatch.setattr(
            worker_mod.execute_agent_job,
            "send_with_options",
            lambda **kw: sent.append(kw),
        )
        # retries >= MAX_JOB_RESCHEDULES => refuse
        assert (
            worker_mod._reschedule_agent_job(
                agent_id=1,
                job_id=1,
                delay_seconds=60,
                retries=worker_mod.MAX_JOB_RESCHEDULES,
            )
            is False
        )
        assert sent == []

    def test_reschedule_carries_retries(self, monkeypatch: pytest.MonkeyPatch):
        from bot.agents import worker as worker_mod

        sent: list[dict] = []
        monkeypatch.setattr(
            worker_mod.execute_agent_job,
            "send_with_options",
            lambda **kw: sent.append(kw),
        )
        assert (
            worker_mod._reschedule_agent_job(
                agent_id=1, job_id=2, delay_seconds=30, retries=1
            )
            is True
        )
        assert len(sent) == 1
        assert sent[0]["retries"] == 2
        assert sent[0]["max_retries"] == worker_mod.MAX_JOB_RESCHEDULES
        assert sent[0]["delay"] == 30_000


class TestReconcileSkipsPendingResume:
    @pytest.mark.asyncio
    async def test_pending_resume_job_not_redispatched(
        self, db_session, session_factory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from bot.agents import dispatch as dispatch_mod
        from bot.agents.dispatch import RESUME_AT_KEY, reconcile_stale_jobs

        monkeypatch.setattr(dispatch_mod, "SessionLocal", session_factory)
        calls: list[int] = []

        async def _fake_dispatch(job_id: int) -> None:
            calls.append(job_id)

        monkeypatch.setattr(dispatch_mod, "dispatch_agent_job", _fake_dispatch)

        agent = _make_agent(db_session)
        await db_session.flush()
        # A PENDING job older than the requeue cutoff, but with a future resume
        # stamp (worker parked it with a delayed Dramatiq message).
        future = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        old = datetime.now(timezone.utc) - timedelta(hours=3)
        job = AgentJob(
            agent_id=agent.id,
            job_type="member_add",
            status=JOB_STATUS_PENDING,
            created_at=old,
            updated_at=old,
            job_payload={
                "target_tg_group_id": -100123,
                "user_ids": [1],
                RESUME_AT_KEY: future,
            },
        )
        db_session.add(job)
        await db_session.commit()

        result = await reconcile_stale_jobs()
        assert result["requeued"] == 0
        assert result["reconciled"] == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_pending_job_without_resume_is_redispatched(
        self, db_session, session_factory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from bot.agents import dispatch as dispatch_mod
        from bot.agents.dispatch import reconcile_stale_jobs

        monkeypatch.setattr(dispatch_mod, "SessionLocal", session_factory)
        calls: list[int] = []

        async def _fake_dispatch(job_id: int) -> None:
            calls.append(job_id)

        monkeypatch.setattr(dispatch_mod, "dispatch_agent_job", _fake_dispatch)

        agent = _make_agent(db_session, external_id="q-noresume")
        await db_session.flush()
        old = datetime.now(timezone.utc) - timedelta(hours=3)
        job = AgentJob(
            agent_id=agent.id,
            job_type="member_add",
            status=JOB_STATUS_PENDING,
            created_at=old,
            updated_at=old,
            job_payload={"target_tg_group_id": -100123, "user_ids": [1]},
        )
        db_session.add(job)
        await db_session.commit()

        result = await reconcile_stale_jobs()
        assert result["requeued"] == 1
        assert calls == [job.id]


class TestDispatchRefusesTerminal:
    @pytest.mark.asyncio
    async def test_dispatch_skips_dispatch_stale(
        self, db_session, session_factory, monkeypatch
    ) -> None:
        from bot.agents import dispatch as dispatch_mod

        enqueued: list[str] = []
        monkeypatch.setattr(dispatch_mod, "SessionLocal", session_factory)
        monkeypatch.setattr(dispatch_mod, "redis_broker", _FakeBroker(enqueued))
        agent = _make_agent(db_session)
        await db_session.flush()
        job = _make_job(db_session, agent, status=JOB_STATUS_DISPATCH_STALE)
        await db_session.commit()

        await dispatch_mod.dispatch_agent_job(job.id)
        assert enqueued == []
        await db_session.refresh(job)
        assert job.status == JOB_STATUS_DISPATCH_STALE  # unchanged

    @pytest.mark.asyncio
    async def test_dispatch_skips_failed(
        self, db_session, session_factory, monkeypatch
    ) -> None:
        from bot.agents import dispatch as dispatch_mod

        enqueued: list[str] = []
        monkeypatch.setattr(dispatch_mod, "SessionLocal", session_factory)
        monkeypatch.setattr(dispatch_mod, "redis_broker", _FakeBroker(enqueued))
        agent = _make_agent(db_session, external_id="q2")
        await db_session.flush()
        job = _make_job(db_session, agent, status=JOB_STATUS_FAILED)
        await db_session.commit()

        await dispatch_mod.dispatch_agent_job(job.id)
        assert enqueued == []
        await db_session.refresh(job)
        assert job.status == JOB_STATUS_FAILED

    @pytest.mark.asyncio
    async def test_dispatch_enqueues_live_queued_job(
        self, db_session, session_factory, monkeypatch
    ) -> None:
        from bot.agents import dispatch as dispatch_mod

        enqueued: list[str] = []
        monkeypatch.setattr(dispatch_mod, "SessionLocal", session_factory)
        monkeypatch.setattr(dispatch_mod, "redis_broker", _FakeBroker(enqueued))
        agent = _make_agent(db_session, external_id="q3")
        await db_session.flush()
        job = _make_job(db_session, agent, status=JOB_STATUS_QUEUED)
        await db_session.commit()

        await dispatch_mod.dispatch_agent_job(job.id)
        assert len(enqueued) == 1
        await db_session.refresh(job)
        assert job.status == JOB_STATUS_QUEUED
