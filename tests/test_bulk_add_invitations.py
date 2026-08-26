"""Tests for bulk-add invitation features (issues #216, #217, #219).

Covers:
- Custom invite message normalization (issue #217).
- Custom message in the Telegram DM (issue #217).
- Already-sent invitation state exposed by the member-search API (issue #216).
- Duplicate pending invitation prevention in BulkAddMembersRuntime (issue #216).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.agents.group_membership import send_invite_link_to_user
from bot.agents.jobs import normalize_member_add_payload
from bot.agents.runtime import BulkAddMembersRuntime
from bot.db.models import MemberOperation

# ─── Issue #217: custom invite message ────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_invite_link_to_user_uses_default_message_when_custom_empty() -> None:
    client = AsyncMock()
    client.send_message = AsyncMock()

    result = await send_invite_link_to_user(client, 123, "https://t.me/+abc", custom_message=None)

    assert result is True
    client.send_message.assert_awaited_once_with(123, "Join our group here: https://t.me/+abc")


@pytest.mark.asyncio
async def test_send_invite_link_to_user_uses_default_message_when_custom_blank() -> None:
    client = AsyncMock()
    client.send_message = AsyncMock()

    result = await send_invite_link_to_user(client, 123, "https://t.me/+abc", custom_message="   ")

    assert result is True
    client.send_message.assert_awaited_once_with(123, "Join our group here: https://t.me/+abc")


@pytest.mark.asyncio
async def test_send_invite_link_to_user_appends_link_to_custom_message() -> None:
    client = AsyncMock()
    client.send_message = AsyncMock()

    result = await send_invite_link_to_user(
        client,
        123,
        "https://t.me/+abc",
        custom_message="Hi, join our workspace!",
    )

    assert result is True
    client.send_message.assert_awaited_once_with(
        123, "Hi, join our workspace!\n\nhttps://t.me/+abc"
    )


@pytest.mark.asyncio
async def test_send_invite_link_to_user_returns_false_on_send_failure() -> None:
    client = AsyncMock()
    client.send_message = AsyncMock(side_effect=RuntimeError("privacy"))

    result = await send_invite_link_to_user(client, 123, "https://t.me/+abc")

    assert result is False


def test_normalize_member_add_payload_drops_blank_custom_message() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "custom_invite_message": "   ",
        }
    )
    assert "custom_invite_message" not in normalized


def test_normalize_member_add_payload_keeps_custom_message() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "custom_invite_message": "  Hello there  ",
        }
    )
    assert normalized["custom_invite_message"] == "Hello there"


def test_normalize_member_add_payload_truncates_long_custom_message() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "custom_invite_message": "x" * 5000,
        }
    )
    assert len(normalized["custom_invite_message"]) == 2000


# ─── Issue #235: lower interval below 1800s with risk acknowledgment ──────────


def test_normalize_member_add_payload_clamps_below_1800_without_ack() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "interval_seconds": 60,
        }
    )
    assert normalized["interval_seconds"] == 30 * 60
    assert normalized["acknowledge_risk"] is False


def test_normalize_member_add_payload_keeps_default_1800_without_ack() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "interval_seconds": 1800,
        }
    )
    assert normalized["interval_seconds"] == 30 * 60


def test_normalize_member_add_payload_accepts_below_1800_with_ack() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "interval_seconds": 120,
            "acknowledge_risk": True,
        }
    )
    assert normalized["interval_seconds"] == 120
    assert normalized["acknowledge_risk"] is True


def test_normalize_member_add_payload_applies_hard_floor_with_ack() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "interval_seconds": 5,
            "acknowledge_risk": True,
        }
    )
    assert normalized["interval_seconds"] == 30


def test_normalize_member_add_payload_keeps_high_interval_with_ack() -> None:
    normalized = normalize_member_add_payload(
        {
            "target_tg_group_id": -1001,
            "user_ids": [1, 2],
            "interval_seconds": 3600,
            "acknowledge_risk": True,
        }
    )
    assert normalized["interval_seconds"] == 3600


# ─── Issue #216: already-sent invitation state ───────────────────────────────
#
# The tests below exercise the DB-backed member-search response. They are
# skipped in environments where the SQLite test schema cannot be created
# because ScrapedMessage.search_vector uses the PostgreSQL-only TSVECTOR type
# (pre-existing limitation that also affects test_scraper_service.py).


@pytest.mark.skip(
    reason="Requires a test DB; SQLite schema creation fails on "
    "ScrapedMessage.search_vector (TSVECTOR, pre-existing infra limitation)"
)
@pytest.mark.asyncio
async def test_member_search_exposes_invitation_status_for_target_group(
    db_session,
) -> None:
    from bot.agents.account_group_membership_service import AccountGroupMembershipService
    from bot.db.models import Agent, Group, ScrapedGroup, ScrapedMember, User

    owner = User(
        tg_user_id=777001,
        username="owner",
        full_name="Owner",
        is_owner=True,
    )
    db_session.add(owner)
    await db_session.flush()

    group = Group(tg_group_id=-100777001, title="Target Group", is_active=True)
    db_session.add(group)
    await db_session.flush()

    agent = Agent(
        group_id=group.id,
        telegram_user_id=777002,
        linked_by_user_id=owner.id,
        external_account_id="agent-invite",
        auth_state="active",
        session_string="session",
    )
    db_session.add(agent)
    await db_session.flush()

    scraped_group = ScrapedGroup(
        tg_group_id=-100777003,
        title="Source Group",
        group_type="supergroup",
        last_agent_id=agent.id,
    )
    db_session.add(scraped_group)
    await db_session.flush()

    member = ScrapedMember(
        scraped_group_id=scraped_group.id,
        tg_group_id=-100777003,
        tg_user_id=777003,
        username="invitee",
        full_name="Invitee",
        role="member",
    )
    db_session.add(member)
    await db_session.flush()

    # MemberOperation for the target group + agent = "already sent"
    db_session.add(
        MemberOperation(
            tg_group_id=-100777001,
            tg_user_id=777003,
            agent_id=agent.id,
            status="sent",
            invitation_link="https://t.me/+abc",
            sent_at=datetime(2026, 8, 20, 18, 10, tzinfo=timezone.utc),
        )
    )
    await db_session.commit()

    service = AccountGroupMembershipService(db_session)
    payload = await service.list_scraped_agent_group_members(
        actor_user_id=owner.id,
        agent_id=agent.id,
        tg_group_id=-100777003,
        target_tg_group_id=-100777001,
        page_size=50,
    )

    assert payload["total"] == 1
    member_row = payload["members"][0]
    assert member_row["user_id"] == 777003
    assert member_row["invitation_status"] == {
        "status": "sent",
        "sent_at": "2026-08-20T18:10:00+00:00",
        "invitation_link": "https://t.me/+abc",
    }


@pytest.mark.skip(
    reason="Requires a test DB; SQLite schema creation fails on "
    "ScrapedMessage.search_vector (TSVECTOR, pre-existing infra limitation)"
)
@pytest.mark.asyncio
async def test_member_search_omits_invitation_status_without_target_group(
    db_session,
) -> None:
    from bot.agents.account_group_membership_service import AccountGroupMembershipService
    from bot.db.models import Agent, Group, ScrapedGroup, ScrapedMember, User

    owner = User(tg_user_id=778001, username="owner", full_name="Owner", is_owner=True)
    db_session.add(owner)
    await db_session.flush()

    group = Group(tg_group_id=-100778001, title="Group", is_active=True)
    db_session.add(group)
    await db_session.flush()

    agent = Agent(
        group_id=group.id,
        telegram_user_id=778002,
        linked_by_user_id=owner.id,
        external_account_id="agent-no-target",
        auth_state="active",
        session_string="session",
    )
    db_session.add(agent)
    await db_session.flush()

    scraped_group = ScrapedGroup(
        tg_group_id=-100778003,
        title="Source Group",
        group_type="supergroup",
        last_agent_id=agent.id,
    )
    db_session.add(scraped_group)
    await db_session.flush()

    db_session.add(
        ScrapedMember(
            scraped_group_id=scraped_group.id,
            tg_group_id=-100778003,
            tg_user_id=778003,
            username="invitee",
            full_name="Invitee",
            role="member",
        )
    )
    await db_session.commit()

    service = AccountGroupMembershipService(db_session)
    payload = await service.list_scraped_agent_group_members(
        actor_user_id=owner.id,
        agent_id=agent.id,
        tg_group_id=-100778003,
        page_size=50,
    )

    assert payload["total"] == 1
    assert payload["members"][0]["invitation_status"] is None


# ─── Issue #216: duplicate pending invitation prevention in runtime ──────────


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


@pytest.mark.asyncio
async def test_bulk_add_runtime_skips_member_with_existing_pending_invitation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bot.agents.runtime import BulkAddMembersRuntime

    # Fake session: the dedup pre-fetch returns an existing pending operation,
    # and the "already member" check returns nothing.
    class FakeRow(tuple):
        """Tuple-like row supporting both row[0] and .tg_user_id access."""

        def __new__(cls, tg_user_id: int):
            return super().__new__(cls, (tg_user_id,))

        @property
        def tg_user_id(self) -> int:
            return self[0]

    class FakeSession:
        async def execute(self, stmt):
            sql = str(stmt)
            if "member_operation" in sql:
                return SimpleNamespace(all=lambda: [FakeRow(779003)])
            if "group_members" in sql:
                return SimpleNamespace(scalar_one_or_none=lambda: None)
            return SimpleNamespace(all=lambda: [], scalar_one_or_none=lambda: None)

        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

        def add(self, *args, **kwargs) -> None:
            return None

    # add_user_to_group fails with a privacy-restricted error (non-skip, non-flood).
    # Because a pending invitation already exists, the runtime must NOT send a
    # duplicate invite and must mark the member as skipped instead.
    add_user_mock = AsyncMock(
        return_value=SimpleNamespace(
            success=False,
            error_code="USER_PRIVACY_RESTRICTED",
            flood_wait_seconds=None,
        )
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    runtime = BulkAddMembersRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779003],
        "interval_seconds": 0,
        "send_invite_link_on_privacy_restricted": True,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(client=client, agent=agent, payload=payload, session=FakeSession())

    # The direct add attempt happens once, but the pending invitation must block
    # the invite-link DM fallback — no duplicate invite is sent. The member is
    # recorded as skipped with the dedup reason (the runtime counts it under
    # failure_count while marking the result status "skipped").
    assert add_user_mock.await_count == 1
    assert result["failure_count"] == 1
    assert result["results"] == [
        {
            "user_id": 779003,
            "status": "skipped",
            "error_code": "USER_PRIVACY_RESTRICTED",
            "reason": "invite_already_sent_by_another_agent",
        }
    ]


# ─── Issue #231: skip privacy-restricted members without waiting ─────────────


class _RecordingRuntime(BulkAddMembersRuntime):
    """Runtime that records sleep calls instead of actually sleeping."""

    def __init__(self) -> None:
        super().__init__()
        self.sleep_calls: list[float] = []
        # BulkAddMembersRuntime.__init__ sets self.sleep = asyncio.sleep as an
        # instance attribute, which would shadow this class method. Re-bind it.
        self.sleep = self._record_sleep

    async def _record_sleep(self, seconds: float) -> None:
        self.sleep_calls.append(seconds)


class _NoOpSession:
    async def execute(self, stmt):
        sql = str(stmt)
        if "member_operation" in sql:
            return SimpleNamespace(all=lambda: [])
        if "group_members" in sql:
            return SimpleNamespace(scalar_one_or_none=lambda: None)
        return SimpleNamespace(all=lambda: [], scalar_one_or_none=lambda: None)

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    def add(self, *args, **kwargs) -> None:
        return None


def _privacy_restricted_result() -> SimpleNamespace:
    return SimpleNamespace(
        success=False,
        error_code="USER_PRIVACY_RESTRICTED",
        flood_wait_seconds=None,
    )


def _success_result() -> SimpleNamespace:
    return SimpleNamespace(success=True, error_code=None, flood_wait_seconds=None)


@pytest.mark.asyncio
async def test_bulk_add_runtime_skips_privacy_restricted_without_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    add_user_mock = AsyncMock(
        side_effect=[
            _privacy_restricted_result(),
            _success_result(),
        ]
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002],
        "interval_seconds": 1800,
        "send_invite_link_on_privacy_restricted": False,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=_NoOpSession()
    )

    # Privacy-restricted member is skipped with the dedicated reason.
    assert result["results"] == [
        {
            "user_id": 779001,
            "status": "skipped",
            "error_code": "USER_PRIVACY_RESTRICTED",
            "reason": "privacy_restricted",
        },
        {
            "user_id": 779002,
            "status": "success",
            "error_code": None,
        },
    ]
    assert result["skip_count"] == 1
    assert result["success_count"] == 1
    # No sleep between the privacy-restricted skip and the next member.
    assert runtime.sleep_calls == []


@pytest.mark.asyncio
async def test_bulk_add_runtime_keeps_interval_after_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    add_user_mock = AsyncMock(
        side_effect=[
            _success_result(),
            _success_result(),
        ]
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002],
        "interval_seconds": 1800,
        "send_invite_link_on_privacy_restricted": False,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=_NoOpSession()
    )

    assert result["success_count"] == 2
    assert result["skip_count"] == 0
    # Successful additions keep the normal interval between members.
    assert len(runtime.sleep_calls) == 1
    assert runtime.sleep_calls[0] > 0


@pytest.mark.asyncio
async def test_bulk_add_runtime_sends_invite_link_fallback_for_privacy_restricted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    add_user_mock = AsyncMock(
        side_effect=[
            _privacy_restricted_result(),
            _success_result(),
        ]
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.export_group_invite_link",
        AsyncMock(return_value="https://t.me/+abc"),
    )
    send_dm_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "bot.agents.group_membership.send_invite_link_to_user",
        send_dm_mock,
    )

    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002],
        "interval_seconds": 1800,
        "send_invite_link_on_privacy_restricted": True,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=_NoOpSession()
    )

    # The invite-link DM fallback is used for privacy-restricted members when
    # enabled, and the normal interval still applies between members.
    assert send_dm_mock.await_count == 1
    assert result["results"][0]["status"] == "invite_link_sent"
    assert result["results"][0]["method"] == "invite_link"
    assert result["invite_link_count"] == 1
    assert len(runtime.sleep_calls) == 1
    assert runtime.sleep_calls[0] > 0


# ─── Issue #229: crash-retry resume skips already-processed users ─────────────


@pytest.mark.asyncio
async def test_bulk_add_runtime_resume_skips_processed_users_on_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # First run processed user 779001 (success) and persisted progress before
    # crashing. The retry re-dispatches with the same payload+progress and must
    # NOT re-invite 779001 — only 779002 is new.
    add_user_mock = AsyncMock(return_value=_success_result())
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002],
        "interval_seconds": 0,
        "send_invite_link_on_privacy_restricted": False,
        "job_id": 1,
        "progress": {
            "total_count": 2,
            "success_count": 1,
            "failure_count": 0,
            "skip_count": 0,
            "invite_link_count": 0,
            "results": [
                {"user_id": 779001, "status": "success", "error_code": None},
            ],
            "stopped_at": 0,
        },
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=_NoOpSession()
    )

    # Only the unprocessed user is invited on the retry.
    assert add_user_mock.await_count == 1
    assert add_user_mock.await_args.args[2] == 779002
    assert result["success_count"] == 2
    assert result["results"] == [
        {"user_id": 779001, "status": "success", "error_code": None},
        {"user_id": 779002, "status": "success", "error_code": None},
    ]


# ─── Non-admin bulk add: Telegram remains the final authority ────────────────


def _not_admin_result() -> SimpleNamespace:
    return SimpleNamespace(
        success=False,
        error_code="NOT_ADMIN",
        flood_wait_seconds=None,
    )


@pytest.mark.asyncio
async def test_bulk_add_runtime_records_not_admin_failure_without_invalidating_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-004/FR-005: when Telegram rejects an add with a permission error
    (CHAT_ADMIN_REQUIRED -> NOT_ADMIN), the runtime records the failure for
    that member and continues — the target group and its scraped data are
    never deleted or invalidated."""
    from bot.db.models import ScrapedGroup, ScrapedMember
    from bot.db.models.audit import MembershipAuditLog

    add_user_mock = AsyncMock(
        side_effect=[
            _not_admin_result(),
            _success_result(),
        ]
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    # Recording session that keeps rows added via session.add().
    class RecordingSession(_NoOpSession):
        def __init__(self) -> None:
            super().__init__()
            self.added: list = []

        def add(self, instance) -> None:
            self.added.append(instance)
            super().add(instance)

    session = RecordingSession()
    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002],
        "interval_seconds": 1800,
        "send_invite_link_on_privacy_restricted": False,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=session
    )

    # The permission failure is a per-member failure; the job keeps going.
    assert result["results"] == [
        {
            "user_id": 779001,
            "status": "failed",
            "error_code": "NOT_ADMIN",
        },
        {
            "user_id": 779002,
            "status": "success",
            "error_code": None,
        },
    ]
    assert result["failure_count"] == 1
    assert result["success_count"] == 1

    # Nothing added to the session may delete or invalidate the target group
    # or its scraped members.
    for instance in session.added:
        assert not isinstance(instance, (ScrapedGroup, ScrapedMember))
    # A MembershipAuditLog is written for the failed add attempt.
    assert any(
        isinstance(instance, MembershipAuditLog)
        and instance.result == "NOT_ADMIN"
        for instance in session.added
    )


@pytest.mark.asyncio
async def test_bulk_add_runtime_continues_after_not_admin_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-004/FR-006: a permission failure on one member does not stop the
    batch; remaining members are still attempted."""
    add_user_mock = AsyncMock(
        side_effect=[
            _not_admin_result(),
            _not_admin_result(),
            _success_result(),
        ]
    )
    monkeypatch.setattr(
        "bot.agents.group_membership.add_user_to_group",
        add_user_mock,
    )

    runtime = _RecordingRuntime()
    payload = {
        "target_tg_group_id": -100779001,
        "user_ids": [779001, 779002, 779003],
        "interval_seconds": 1800,
        "send_invite_link_on_privacy_restricted": False,
        "job_id": 1,
    }
    client = SimpleNamespace()
    agent = _FakeAgent()

    result = await runtime.execute(
        client=client, agent=agent, payload=payload, session=_NoOpSession()
    )

    assert add_user_mock.await_count == 3
    assert [r["error_code"] for r in result["results"]] == [
        "NOT_ADMIN",
        "NOT_ADMIN",
        None,
    ]
    assert result["failure_count"] == 2
    assert result["success_count"] == 1
