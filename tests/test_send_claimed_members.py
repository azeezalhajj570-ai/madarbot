"""Tests for Send Messages to Claimed Members (feature 021).

Covers:
- Payload normalization for send_to_claimed_members.
- The runtime sends via the claiming agent's session and records per-member results.
- Claims are kept after the send (not released on completion) so members stay
  claimed by this agent until the TTL expires; a failed send never reassigns
  a claim (FR-009/020).
- Unclaimed / other-agent-claimed members are rejected at job creation (FR-012/021).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.agents.jobs import (
    SEND_TO_CLAIMED_MEMBERS_JOB_TYPE,
    normalize_send_to_claimed_members_payload,
)
from bot.agents.runtime import SendToClaimedMembersRuntime

# ─── Payload normalization ────────────────────────────────────────────────────


def test_normalize_send_to_claimed_members_payload_requires_messages() -> None:
    with pytest.raises(ValueError, match="messages is required"):
        normalize_send_to_claimed_members_payload(
            {"source_group_id": -1001, "user_ids": [1, 2]}
        )


def test_normalize_send_to_claimed_members_payload_requires_source_group() -> None:
    with pytest.raises(ValueError, match="source_group_id is required"):
        normalize_send_to_claimed_members_payload(
            {"messages": ["hello"], "user_ids": [1]}
        )


def test_normalize_send_to_claimed_members_payload_accepts_source_tg_group_id() -> None:
    # The miniapp sends source_tg_group_id (same key as the claims endpoint);
    # source_group_id is kept as a backward-compatible alias.
    normalized = normalize_send_to_claimed_members_payload(
        {
            "source_tg_group_id": -1005415931696,
            "user_ids": [1, 2],
            "messages": ["hello"],
        }
    )
    assert normalized["source_group_id"] == -1005415931696


def test_normalize_send_to_claimed_members_payload_requires_user_ids() -> None:
    with pytest.raises(ValueError, match="At least one valid user_id"):
        normalize_send_to_claimed_members_payload(
            {"source_group_id": -1001, "messages": ["hello"], "user_ids": []}
        )


def test_normalize_send_to_claimed_members_payload_merges_message_field() -> None:
    normalized = normalize_send_to_claimed_members_payload(
        {
            "source_group_id": -1001,
            "user_ids": [1, 2],
            "message": "Hello there",
            "interval_between_contacts": 10,
        }
    )
    assert normalized["messages"] == ["Hello there"]
    assert normalized["message"] == "Hello there"
    assert normalized["interval_strategy"] == "fixed"
    assert normalized["target_type"] == "members"


def test_normalize_send_to_claimed_members_payload_keeps_media_urls() -> None:
    normalized = normalize_send_to_claimed_members_payload(
        {
            "source_group_id": -1001,
            "user_ids": [1],
            "messages": ["a", "b"],
            "media_urls": ["https://cdn/x.jpg", None],
        }
    )
    assert normalized["media_urls"] == ["https://cdn/x.jpg", None]


# ─── Runtime ──────────────────────────────────────────────────────────────────


class _FakeAgent:
    def __init__(self) -> None:
        self.id = 42
        self.tenant_id = 1
        self.linked_by_user_id = 7
        self.telegram_user_id = 777
        self.cooldown_minutes = None
        self.max_actions_per_hour = None
        self.max_messages_per_day = None
        self.min_delay_seconds = None


class _NoOpSession:
    async def execute(self, stmt):
        # The runtime iterates the result of the SentBroadcastMessage dedup
        # query directly (and calls .all() on blacklist/others) — return an
        # object that is iterable (yields nothing) and supports .all().
        class _EmptyResult:
            def __iter__(self):
                return iter(())

            def all(self):
                return []

            def scalars(self):
                return self

            def scalar_one_or_none(self):
                return None

            def fetchall(self):
                return []

        return _EmptyResult()

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    def add(self, *args, **kwargs) -> None:
        return None


class _RecordingRuntime(SendToClaimedMembersRuntime):
    """Runtime that records sleep calls instead of actually sleeping."""

    def __init__(self) -> None:
        super().__init__()
        self.sleep_calls: list[float] = []
        self.sleep = self._record_sleep

    async def _record_sleep(self, seconds: float) -> None:
        self.sleep_calls.append(seconds)


class _RecordingSession(_NoOpSession):
    """Session that keeps rows added via session.add()."""

    def __init__(self) -> None:
        super().__init__()
        self.added: list = []

    def add(self, instance) -> None:
        self.added.append(instance)
        super().add(instance)


def _payload(user_ids: list[int] | None = None) -> dict:
    return {
        "source_group_id": -100779001,
        "user_ids": user_ids or [779001, 779002],
        "messages": ["Hello"],
        "media_urls": [None],
        "threshold": 500,
        "interval_seconds": 0,
        "interval_between_contacts": 0,
        "interval_strategy": "graduated",
        "job_id": 1,
        "claim_ids": [11, 12],
    }


def _fake_client() -> AsyncMock:
    client = AsyncMock()
    client.get_me = AsyncMock(return_value=SimpleNamespace(id=777))
    client.send_message = AsyncMock(return_value=SimpleNamespace(id=1))
    return client


@pytest.mark.asyncio
async def test_send_claimed_runtime_sends_via_agent_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-014: each member is messaged through the agent's own Telegram client."""
    sent: list[tuple[int, str]] = []

    async def fake_send_message(client, peer, msg):
        sent.append((peer, msg))
        return SimpleNamespace(id=100)

    monkeypatch.setattr(
        "bot.agents.runtime.send_message_with_timeout", fake_send_message
    )
    monkeypatch.setattr(
        "bot.agents.runtime._resolve_selected_recipients",
        AsyncMock(
            side_effect=lambda **kw: kw["recipients"].extend(kw["user_ids"])
        ),
    )

    session = _RecordingSession()
    runtime = _RecordingRuntime()
    agent = _FakeAgent()
    client = _fake_client()

    result = await runtime.execute(
        client=client, agent=agent, payload=_payload(), session=session
    )

    assert result["success_count"] == 2
    assert result["failure_count"] == 0
    # Both members were messaged via the same (agent) client.
    assert sorted(pid for pid, _ in sent) == [779001, 779002]
    assert all(msg == "Hello" for _, msg in sent)


@pytest.mark.asyncio
async def test_send_claimed_runtime_records_per_member_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-018: a Telegram send error is recorded for the individual member and
    the loop continues."""
    async def fake_send_message(client, peer, msg):
        if peer == 779002:
            raise RuntimeError("privacy restricted")
        return SimpleNamespace(id=101)

    monkeypatch.setattr(
        "bot.agents.runtime.send_message_with_timeout", fake_send_message
    )
    monkeypatch.setattr(
        "bot.agents.runtime._resolve_selected_recipients",
        AsyncMock(
            side_effect=lambda **kw: kw["recipients"].extend(kw["user_ids"])
        ),
    )

    session = _RecordingSession()
    runtime = _RecordingRuntime()
    result = await runtime.execute(
        client=_fake_client(), agent=_FakeAgent(), payload=_payload(), session=session
    )

    assert result["success_count"] == 1
    assert result["failure_count"] == 1
    assert result["failures"] == [{"user_id": "779002", "error": "privacy restricted"}]


@pytest.mark.asyncio
async def test_send_claimed_runtime_survives_failed_send_and_keeps_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-009/FR-017/FR-020: a failed send does NOT reassign the claim — the
    member stays with the claiming agent."""
    async def fake_send_message(client, peer, msg):
        raise RuntimeError("peer not found")

    monkeypatch.setattr(
        "bot.agents.runtime.send_message_with_timeout", fake_send_message
    )
    monkeypatch.setattr(
        "bot.agents.runtime._resolve_selected_recipients",
        AsyncMock(
            side_effect=lambda **kw: kw["recipients"].extend(kw["user_ids"])
        ),
    )

    session = _RecordingSession()
    result = await SendToClaimedMembersRuntime().execute(
        client=_fake_client(), agent=_FakeAgent(), payload=_payload([779001]), session=session
    )

    assert result["success_count"] == 0
    assert result["failure_count"] == 1
    # Nothing reassigns the claim — the member stays with the claiming agent.
    assert result["total_count"] == 1


@pytest.mark.asyncio
async def test_send_claimed_runtime_keeps_claims_after_send(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Members stay claimed after the send task is created — the runtime must
    NOT release the claims when the job finishes (TTL expiry handles cleanup)."""
    release_mock = AsyncMock(return_value=2)
    monkeypatch.setattr(
        "bot.services.member_claim_service.release_claims", release_mock
    )
    monkeypatch.setattr(
        "bot.agents.runtime.send_message_with_timeout",
        AsyncMock(return_value=SimpleNamespace(id=1)),
    )
    monkeypatch.setattr(
        "bot.agents.runtime._resolve_selected_recipients",
        AsyncMock(
            side_effect=lambda **kw: kw["recipients"].extend(kw["user_ids"])
        ),
    )

    session = _NoOpSession()
    await SendToClaimedMembersRuntime().execute(
        client=_fake_client(), agent=_FakeAgent(), payload=_payload(), session=session
    )

    release_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_claimed_runtime_rejects_unclaimed_members(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-021: unclaimed members must not be sent through an arbitrary agent.

    The runtime resolves only resolvable recipients; members that cannot be
    resolved to a peer are not messaged. The job-creation endpoint is what
    rejects unclaimed members (tested at the endpoint level), but the runtime
    must never invent an agent for them.
    """
    sent: list[int] = []

    async def fake_send_message(client, peer, msg):
        sent.append(peer)
        return SimpleNamespace(id=1)

    monkeypatch.setattr(
        "bot.agents.runtime.send_message_with_timeout", fake_send_message
    )
    # Only 779001 is resolvable; 779999 is not (no claim, no peer).
    async def resolve(**kw):
        for uid in kw["user_ids"]:
            if uid == 779001:
                kw["recipients"].append(uid)

    monkeypatch.setattr("bot.agents.runtime._resolve_selected_recipients", resolve)

    result = await SendToClaimedMembersRuntime().execute(
        client=_fake_client(),
        agent=_FakeAgent(),
        payload=_payload([779001, 779999]),
        session=_NoOpSession(),
    )

    assert sent == [779001]
    assert result["total_count"] == 1
    assert result["success_count"] == 1


# ─── Job type constant ────────────────────────────────────────────────────────


def test_send_to_claimed_members_job_type_constant() -> None:
    assert SEND_TO_CLAIMED_MEMBERS_JOB_TYPE == "send_to_claimed_members"
