"""Regression tests for rate limits on event-triggered automation tasks (issue #306).

A cooldown or hourly-cap stop used to `return False` from
`AgentTaskRuntime.execute()`. The worker reads a falsy return as "no handler for
this job type" and records a terminal failure:

    last_error = "Unhandled job type: automation_task"

so every keyword reply that arrived while the agent was cooling down was marked
failed and never sent. These stops must raise AgentStopError instead: the worker
then parks the job as PENDING, stamps `_resume_at`, and re-dispatches it once the
delay has elapsed.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any

import pytest

from bot.agents.exceptions import AgentStopError
from bot.agents.runtime import AgentTaskRuntime
from bot.automation.registry import build_default_registry


class _FakeRedis:
    """Minimal redis stand-in for the rate-limiter keys."""

    def __init__(self, store: dict[str, Any] | None = None, ttl: int = -2) -> None:
        self._store: dict[str, Any] = dict(store or {})
        self._ttl = ttl
        self.set_calls: list[tuple[str, Any]] = []

    async def get(self, key):
        raw = self._store.get(key)
        return str(raw) if raw is not None else None

    async def set(self, key, value, ex=None) -> None:
        self._store[key] = value
        self.set_calls.append((key, ex))

    async def ttl(self, key) -> int:
        return self._ttl

    async def incr(self, key) -> int:
        self._store[key] = int(self._store.get(key, 0)) + 1
        return self._store[key]

    async def expire(self, key, ttl) -> None:
        pass

    async def aclose(self) -> None:
        pass


def _make_agent(**overrides: Any) -> SimpleNamespace:
    agent = SimpleNamespace(
        id=44,
        tenant_id=None,
        cooldown_minutes=None,
        max_actions_per_hour=None,
        min_delay_seconds=None,
        safety_mode_enabled=False,
        safety_mode_until=None,
    )
    for key, value in overrides.items():
        setattr(agent, key, value)
    return agent


def _make_job(
    task_key: str = "reply_message", assignment_id: str | None = "d90300c933534b5790c7f3e805e79530"
) -> SimpleNamespace:
    return SimpleNamespace(
        id=795,
        job_payload={
            "task_key": task_key,
            "assignment_id": assignment_id,
            "task_config": {"message_template": "hello", "reply_mode": "private"},
            "conditions": {"text_contains": "hello"},
            "event": {
                "name": "message.received",
                "group_id": 938488,
                "user_id": 8564145723,
                "payload": {"chat_id": -1001355987441, "message_id": 340937, "text": "hello"},
            },
        },
    )


def _runtime() -> AgentTaskRuntime:
    return AgentTaskRuntime(registry=build_default_registry())


async def test_cooldown_raises_agent_stop_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An agent in cooldown must defer the job, not report it as unhandled."""
    monkeypatch.setattr(
        "redis.asyncio.Redis.from_url", lambda url, **kw: _FakeRedis(ttl=46070)
    )

    agent = _make_agent(cooldown_minutes=1000)

    with pytest.raises(AgentStopError) as exc_info:
        await _runtime().execute(
            client=object(), agent=agent, job=_make_job(), session=None
        )

    assert exc_info.value.stop_reason == "cooldown"
    assert exc_info.value.delay == 46070


async def test_hourly_limit_raises_agent_stop_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exceeding the hourly cap defers until the window resets."""
    window = int(time.time()) // 3600
    fake_redis = _FakeRedis(store={f"agent:44:window:{window}": 2})
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda url, **kw: fake_redis)

    agent = _make_agent(max_actions_per_hour=2)

    with pytest.raises(AgentStopError) as exc_info:
        await _runtime().execute(
            client=object(), agent=agent, job=_make_job(), session=None
        )

    assert exc_info.value.stop_reason == "hourly_limit"
    assert 0 < exc_info.value.delay <= 3600
    # No cooldown configured, so none is started.
    assert fake_redis.set_calls == []


async def test_hourly_limit_defers_past_a_started_cooldown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the cap starts a cooldown, defer past the whole cooldown window.

    Waking at the hourly reset would land back inside the cooldown and burn one
    of the capped MAX_JOB_RESCHEDULES slots.
    """
    window = int(time.time()) // 3600
    fake_redis = _FakeRedis(store={f"agent:44:window:{window}": 50})
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda url, **kw: fake_redis)

    agent = _make_agent(max_actions_per_hour=50, cooldown_minutes=1000)

    with pytest.raises(AgentStopError) as exc_info:
        await _runtime().execute(
            client=object(), agent=agent, job=_make_job(), session=None
        )

    assert exc_info.value.stop_reason == "hourly_limit"
    assert exc_info.value.delay == 1000 * 60
    assert fake_redis.set_calls == [("agent:44:cooldown", 1000 * 60)]


async def test_missing_assignment_id_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A payload with no task at all is the only remaining unhandled case.

    The worker's terminal "Unhandled job type" branch is reserved for this; a
    rate limit must never reach it.
    """
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda url, **kw: _FakeRedis())

    agent = _make_agent(cooldown_minutes=1000)

    handled = await _runtime().execute(
        client=object(), agent=agent, job=_make_job(assignment_id=None), session=None
    )

    assert handled is False
