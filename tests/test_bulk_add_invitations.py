"""Tests for bulk-add invitation features (issues #216, #217, #219).

Covers:
- Custom invite message normalization (issue #217).
- Custom message in the Telegram DM (issue #217).
- Already-sent invitation state exposed by the member-search API (issue #216).
- Duplicate pending invitation prevention in BulkAddMembersRuntime (issue #216).
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.agents.group_membership import send_invite_link_to_user
from bot.agents.jobs import normalize_member_add_payload
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
