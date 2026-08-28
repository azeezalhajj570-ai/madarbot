from __future__ import annotations

import pytest
from sqlalchemy import select

from bot.db.models import ScrapedGroup, ScrapedMember, ScrapedMessage
from bot.services.scraper_service import ScraperService


@pytest.mark.asyncio
async def test_scraper_bulk_upserts_replace_existing_rows_without_duplicates(db_session) -> None:
    scraped_group = ScrapedGroup(
        tg_group_id=-1007001, title="Scraper Group", group_type="supergroup"
    )
    db_session.add(scraped_group)
    await db_session.commit()

    service = ScraperService(db_session)

    await service._bulk_upsert_scraped_members(
        [
            service._build_scraped_member_row(
                scraped_group_id=scraped_group.id,
                tg_group_id=scraped_group.tg_group_id,
                tg_user_id=501,
                username="first-pass",
                first_name="First",
                full_name="First Pass",
                role="member",
                raw_data={"source": "initial"},
            )
        ],
        scraped_by_agent_id=1,
    )
    await service._bulk_upsert_scraped_members(
        [
            service._build_scraped_member_row(
                scraped_group_id=scraped_group.id,
                tg_group_id=scraped_group.tg_group_id,
                tg_user_id=501,
                username="second-pass",
                first_name="Second",
                full_name="Second Pass",
                role="admin",
                raw_data={"source": "updated"},
            )
        ],
        scraped_by_agent_id=1,
    )

    await service._bulk_upsert_scraped_messages(
        [
            service._build_scraped_message_row(
                scraped_group_id=scraped_group.id,
                tg_group_id=scraped_group.tg_group_id,
                message_id=9001,
                sender_user_id=501,
                sender_username="first-pass",
                message_text="first",
                message_type="text",
                raw_data={"source": "initial"},
            )
        ]
    )
    await service._bulk_upsert_scraped_messages(
        [
            service._build_scraped_message_row(
                scraped_group_id=scraped_group.id,
                tg_group_id=scraped_group.tg_group_id,
                message_id=9001,
                sender_user_id=501,
                sender_username="second-pass",
                message_text="second",
                message_type="document",
                raw_data={"source": "updated"},
            )
        ]
    )
    await db_session.commit()

    members = (
        (
            await db_session.execute(
                select(ScrapedMember).where(
                    ScrapedMember.tg_group_id == scraped_group.tg_group_id,
                    ScrapedMember.tg_user_id == 501,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(members) == 1
    assert members[0].username == "second-pass"
    assert members[0].role == "admin"
    assert members[0].raw_data["source"] == "updated"

    messages = (
        (
            await db_session.execute(
                select(ScrapedMessage).where(
                    ScrapedMessage.tg_group_id == scraped_group.tg_group_id,
                    ScrapedMessage.message_id == 9001,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(messages) == 1
    assert messages[0].sender_username == "second-pass"
    assert messages[0].message_text == "second"
    assert messages[0].message_type == "document"
    assert messages[0].raw_data["source"] == "updated"


# ─── Issue: checkpointed scrape resume (stale last_scraped_message_id) ───────


class _FakeScrapedGroup:
    def __init__(self, group_id: int, tg_group_id: int) -> None:
        self.id = group_id
        self.tg_group_id = tg_group_id
        self.scrape_state: dict | None = None
        self.updated_at = None


@pytest.mark.asyncio
async def test_checkpoint_resume_uses_db_max_when_checkpoint_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A corrupted checkpoint (last_scraped_message_id=1) must not cause a
    re-scrape of already-stored history — the DB max wins."""
    from types import SimpleNamespace as NS

    from bot.services import scraper_service as svc

    fake_group = _FakeScrapedGroup(170, -1002024486812)
    fake_group.scrape_state = {
        "messages": {
            "last_scraped_message_id": 1,
            "total_success": 10445,
            "total_errors": 0,
            "batches_completed": 105,
            "last_batch_at": "2026-08-23T22:26:13.140153",
        }
    }

    class FakeSession:
        async def execute(self, stmt):
            sql = str(stmt)
            if "max(" in sql:
                return NS(scalar_one_or_none=lambda: 18018)
            # Existing admin roles query.
            if "admin_roles" in sql or "members" in sql:
                return NS(scalars=lambda: NS(all=lambda: []))
            return NS(scalar_one_or_none=lambda: None, scalars=lambda: NS(all=lambda: []))

        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

        def add(self, *a, **k) -> None:
            return None

    # Mock the module helpers used inside scrape_messages_checkpointed.
    async def fake_get_or_create_group(**kw):
        return fake_group

    monkeypatch.setattr(
        svc.entity_resolver,
        "get_or_create_group_from_client",
        fake_get_or_create_group,
    )
    async def fake_resolve_group_entity(*a, **kw):
        return NS(id=-1002024486812, access_hash=123)

    monkeypatch.setattr(
        svc.entity_resolver,
        "resolve_group_entity",
        fake_resolve_group_entity,
    )
    monkeypatch.setattr(
        svc.ScraperService, "_update_scrape_progress", lambda *a, **kw: None
    )
    monkeypatch.setattr(
        svc.bulk_upsert, "bulk_upsert_scraped_messages", lambda *a, **kw: None
    )
    monkeypatch.setattr(
        svc.bulk_upsert, "bulk_upsert_scraped_members", lambda *a, **kw: None
    )
    monkeypatch.setattr(
        svc.serializers,
        "build_message_row_from_msg",
        lambda *a, **kw: {"message_id": 1},
    )
    monkeypatch.setattr(
        svc.serializers, "build_member_row_from_sender", lambda *a, **kw: None
    )

    async def fake_get_active_agent(agent_id: int, session=None):
        return NS(id=agent_id, tenant_id=1)

    monkeypatch.setattr(
        svc.entity_resolver, "get_active_agent", fake_get_active_agent
    )

    # Telethon client: returns newest-first messages, then stops.
    calls = {"n": 0}

    async def fake_client_call(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return NS(
                messages=[
                    NS(id=18018, date=None),
                    NS(id=17000, date=None),
                ]
            )
        return NS(messages=[])

    class FakeClient:
        async def __call__(self, request):
            return await fake_client_call(request)

    client = FakeClient()

    service = svc.ScraperService(FakeSession())
    result = await service.scrape_messages_checkpointed(
        agent_id=14,
        tg_group_id=-1002024486812,
        limit=1000000,
        max_age_days=30,
        client=client,
    )

    # The stale checkpoint of 1 is corrected to the DB max (18018), so the
    # scrape stops immediately at the first already-scraped message and stores
    # the boundary in the checkpoint.
    assert result["success_count"] == 0
    assert fake_group.scrape_state["messages"]["last_scraped_message_id"] == 18018


@pytest.mark.asyncio
async def test_checkpoint_resume_scrapes_only_new_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With a valid checkpoint at 18018, a resume scrapes only messages newer
    than the boundary and updates the checkpoint to the new max."""
    from types import SimpleNamespace as NS

    from bot.services import scraper_service as svc

    fake_group = _FakeScrapedGroup(170, -1002024486812)
    fake_group.scrape_state = {
        "messages": {
            "last_scraped_message_id": 18018,
            "total_success": 10417,
            "total_errors": 0,
            "batches_completed": 105,
            "last_batch_at": "2026-08-23T22:26:13.140153",
        }
    }

    class FakeSession:
        async def execute(self, stmt):
            sql = str(stmt)
            if "max(" in sql:
                return NS(scalar_one_or_none=lambda: 18018)
            return NS(scalar_one_or_none=lambda: None, scalars=lambda: NS(all=lambda: []))

        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

        def add(self, *a, **k) -> None:
            return None

    async def fake_get_or_create_group(**kw):
        return fake_group

    monkeypatch.setattr(
        svc.entity_resolver,
        "get_or_create_group_from_client",
        fake_get_or_create_group,
    )

    async def fake_resolve_group_entity(*a, **kw):
        return NS(id=-1002024486812, access_hash=123)

    monkeypatch.setattr(
        svc.entity_resolver,
        "resolve_group_entity",
        fake_resolve_group_entity,
    )
    monkeypatch.setattr(
        svc.ScraperService, "_update_scrape_progress", lambda *a, **kw: None
    )
    async def fake_upsert_messages(*a, **kw):
        return None

    async def fake_upsert_members(*a, **kw):
        return None

    monkeypatch.setattr(
        svc.bulk_upsert, "bulk_upsert_scraped_messages", fake_upsert_messages
    )
    monkeypatch.setattr(
        svc.bulk_upsert, "bulk_upsert_scraped_members", fake_upsert_members
    )
    monkeypatch.setattr(
        svc.serializers,
        "build_message_row_from_msg",
        lambda *a, **kw: {"message_id": 1},
    )
    monkeypatch.setattr(
        svc.serializers, "build_member_row_from_sender", lambda *a, **kw: None
    )

    async def fake_get_active_agent(agent_id: int, session=None):
        return NS(id=agent_id, tenant_id=1)

    monkeypatch.setattr(
        svc.entity_resolver, "get_active_agent", fake_get_active_agent
    )

    calls = {"n": 0}

    async def fake_client_call(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return NS(
                messages=[
                    NS(id=19001, date=None),
                    NS(id=18500, date=None),
                    NS(id=18018, date=None),  # already scraped -> stop
                ]
            )
        return NS(messages=[])

    class FakeClient:
        async def __call__(self, request):
            return await fake_client_call(request)

    service = svc.ScraperService(FakeSession())
    result = await service.scrape_messages_checkpointed(
        agent_id=14,
        tg_group_id=-1002024486812,
        limit=1000000,
        max_age_days=30,
        client=FakeClient(),
    )

    # Two new messages were scraped, and the boundary advanced to 19001.
    assert result["success_count"] == 2
    assert fake_group.scrape_state["messages"]["last_scraped_message_id"] == 19001


# ─── sync_agent_groups records the agent's own membership ────────────────────


class _FakeDialog:
    def __init__(self, entity) -> None:
        self.entity = entity
        self.id = entity.id
        self.is_group = True
        self.is_channel = False


class _FakeEntity:
    def __init__(self, *, id: int, title: str, username: str | None) -> None:
        self.id = id
        self.title = title
        self.username = username
        self.broadcast = False
        self.megagroup = True
        self.participants_count = 10
        self.user_count = None
        self.access_hash = 999
        self.bot = False
        self.premium = False


class _FakeClient:
    def __init__(self, dialogs: list) -> None:
        self._dialogs = dialogs

    async def iter_dialogs(self):
        for dialog in self._dialogs:
            yield dialog

    async def disconnect(self) -> None:
        return None


@pytest.mark.asyncio
async def test_sync_agent_groups_records_agent_own_membership(
    db_session, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """sync_agent_groups must upsert a ScrapedMember row for the agent's own
    telegram_user_id per dialog group, so the group shows as is_member=True in
    the members list without requiring a full scrape."""
    from bot.agents.account_group_membership_service import AccountGroupMembershipService
    from bot.db.models import Agent, Group, User

    owner = User(tg_user_id=70001, username="owner", full_name="Owner")
    db_session.add(owner)
    await db_session.flush()

    group = Group(
        tg_group_id=-10077001, title="Synced Group", owner_user_id=owner.id, is_active=True
    )
    db_session.add(group)
    await db_session.flush()

    agent = Agent(
        group_id=group.id,
        telegram_user_id=77101,
        linked_by_user_id=owner.tg_user_id,
        external_account_id="sync-agent",
        status="active",
        auth_state="active",
        session_string="session:sync",
        details={"username": "agent_self", "full_name": "Agent Self"},
    )
    db_session.add(agent)
    await db_session.flush()
    await db_session.commit()

    from bot.services import scraper_service as svc

    async def fake_get_active_agent(agent_id: int, session=None):
        return (
            await db_session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one_or_none()

    monkeypatch.setattr(svc.entity_resolver, "get_active_agent", fake_get_active_agent)

    fake_entity = _FakeEntity(
        id=-10077001, title="Synced Group", username="synced_group"
    )
    client = _FakeClient([_FakeDialog(fake_entity)])
    service = svc.ScraperService(db_session)
    results = await service.sync_agent_groups(agent_id=agent.id, client=client)

    assert len(results) == 1

    member = (
        await db_session.execute(
            select(ScrapedMember).where(
                ScrapedMember.tg_group_id == -10077001,
                ScrapedMember.tg_user_id == 77101,
            )
        )
    ).scalar_one_or_none()
    assert member is not None
    assert member.username == "agent_self"
    assert member.role == "member"

    groups = await AccountGroupMembershipService(db_session).list_managed_member_groups(
        actor_user_id=owner.tg_user_id,
        agent_id=agent.id,
    )
    assert len(groups) == 1
    assert groups[0]["tg_group_id"] == -10077001
    assert groups[0]["is_member"] is True
    assert groups[0]["can_add_members"] is True
