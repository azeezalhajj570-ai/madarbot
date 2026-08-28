from __future__ import annotations

from types import SimpleNamespace

import pytest

from bot.agents.exceptions import AgentStopError
from bot.agents.runtime import BulkAddMembersRuntime


class _FakeSessionResult:
    def __init__(self, scalar=None, rows=None) -> None:
        self._scalar = scalar
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return list(self._rows)


class _FakeSession:
    """Minimal async session fake: all lookups return empty/None so the runtime
    reaches the add path, and the AgentJob lookup returns a mutable job row."""

    def __init__(self) -> None:
        self.job_row = SimpleNamespace(job_payload={})
        self.committed = 0

    async def execute(self, stmt):
        descriptions = getattr(stmt, "column_descriptions", []) or []
        entity = descriptions[0].get("entity") if descriptions else None
        cls_name = getattr(entity, "__name__", None)
        if cls_name == "AgentJob":
            return _FakeSessionResult(scalar=self.job_row)
        return _FakeSessionResult()

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        pass

    def add(self, instance) -> None:
        pass


class _FakeRedis:
    def __init__(self) -> None:
        self._store: dict[str, int] = {}

    async def get(self, key):
        raw = self._store.get(key, 0)
        return str(raw) if raw else None

    async def incr(self, key):
        self._store[key] = self._store.get(key, 0) + 1
        return self._store[key]

    async def expire(self, key, ttl) -> None:
        pass

    async def scard(self, key) -> int:
        return 0

    async def sismember(self, key, member) -> bool:
        return False

    async def sadd(self, key, *members) -> int:
        return 0

    async def aclose(self) -> None:
        pass


def _flood_result() -> SimpleNamespace:
    return SimpleNamespace(success=False, error_code="FLOOD_WAIT", flood_wait_seconds=60)


def _make_agent() -> SimpleNamespace:
    return SimpleNamespace(
        id=14,
        tenant_id=None,
        cooldown_minutes=None,
        max_actions_per_hour=None,
        max_messages_per_day=None,
        min_delay_seconds=None,
        linked_by_user_id=0,
        telegram_user_id=999,
    )


async def test_member_add_raises_agent_stop_error_on_flood(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_add_user_to_group(client, group_id, user_id, **kwargs):
        return _flood_result()

    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group", _fake_add_user_to_group
    )
    monkeypatch.setattr(
        "redis.asyncio.Redis.from_url", lambda url, **kw: _FakeRedis()
    )

    session = _FakeSession()
    runtime = BulkAddMembersRuntime(sleep=lambda s: None)
    agent = _make_agent()

    payload = {
        "target_tg_group_id": -1004420422610,
        "user_ids": [1726217833],
        "source_tg_group_id": -1002024486812,
        "interval_seconds": 1.0,
        "job_id": 140,
    }

    with pytest.raises(AgentStopError) as exc_info:
        await runtime.execute(client=object(), agent=agent, payload=payload, session=session)

    assert exc_info.value.delay == 60
    assert exc_info.value.stop_reason == "flood_wait"

    progress = exc_info.value.progress
    assert progress["stop_reason"] == "flood_wait"
    assert progress["retry_after"] == 60
    assert progress["failure_count"] == 1
    # The flood-blocked user must be recorded so the resumed run skips it
    # instead of re-attempting the same user forever (the resume loop).
    assert progress["results"] == [
        {
            "user_id": 1726217833,
            "status": "failed",
            "error_code": "FLOOD_WAIT",
            "flood_wait_seconds": 60,
        }
    ]
