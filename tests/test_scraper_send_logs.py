"""Tests for scraper job logs in the task activity / send-logs view (issue #234)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bot.dashboard.api.main import app
from bot.db.models import Agent, AgentJob, Group, GroupAdminRole


@pytest_asyncio.fixture
async def api_client(patch_db_dependencies) -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _webapp_init_data(*, user_id: int, bot_token: str = "123456:TESTTOKEN") -> str:
    payload = {
        "auth_date": str(int(time.time())),
        "query_id": "AAEAAAE",
        "user": json.dumps(
            {"id": user_id, "username": f"user{user_id}", "first_name": "Test"},
            separators=(",", ":"),
        ),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    payload["hash"] = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return urlencode(payload)


@pytest.mark.asyncio
async def test_send_logs_returns_scraper_full_group_summary(
    api_client, db_session
) -> None:
    group = Group(tg_group_id=-100234001, title="Scraper Logs Group", is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=9901, role="owner"))
    agent = Agent(
        group_id=group.id,
        telegram_user_id=9901,
        external_account_id="agent-scraper-logs",
        auth_state="active",
        status="active",
        details={"label": "primary"},
    )
    db_session.add(agent)
    await db_session.flush()

    db_session.add(
        AgentJob(
            agent_id=agent.id,
            job_type="scraper_full_group",
            status="completed",
            job_payload={
                "tg_group_id": -100234002,
                "result": {
                    "job_type": "scraper_full_group",
                    "tg_group_id": -100234002,
                    "group_info": {
                        "id": 1,
                        "title": "Source Scrape Group",
                        "username": "src_scrape",
                        "group_type": "supergroup",
                        "member_count": 123,
                    },
                    "members": {"success_count": 10, "error_count": 0, "total_scraped": 10},
                    "messages": {
                        "success_count": 50,
                        "error_count": 0,
                        "total_scraped": 50,
                        "member_success_count": 5,
                        "batches": 3,
                        "completed": True,
                        "last_offset_id": 1,
                    },
                },
            },
        )
    )
    await db_session.commit()

    response = await api_client.get(
        f"/api/agents/{agent.id}/send-logs",
        params={"job_id": 1},
        headers={
            "X-Telegram-Init-Data": _webapp_init_data(user_id=9901),
            "X-App-Boundary": "admin",
        },
    )
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["logs"]) == 1
    row = payload["logs"][0]
    assert row["group_title"] == "Source Scrape Group"
    assert row["username"] == "src_scrape"
    assert row["status"] == "success"
    assert row["method"] == "scraper_full_group"
    assert "members: 10" in row["message_preview"]
    assert "messages: 50" in row["message_preview"]
    assert "batches: 3" in row["message_preview"]


@pytest.mark.asyncio
async def test_send_logs_returns_scraper_members_summary(
    api_client, db_session
) -> None:
    group = Group(tg_group_id=-100234003, title="Scraper Members Group", is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=9901, role="owner"))
    agent = Agent(
        group_id=group.id,
        telegram_user_id=9901,
        external_account_id="agent-scraper-members",
        auth_state="active",
        status="active",
        details={"label": "primary"},
    )
    db_session.add(agent)
    await db_session.flush()

    db_session.add(
        AgentJob(
            agent_id=agent.id,
            job_type="scraper_members",
            status="completed",
            job_payload={
                "tg_group_id": -100234004,
                "result": {
                    "job_type": "scraper_members",
                    "tg_group_id": -100234004,
                    "success_count": 7,
                    "error_count": 1,
                    "total_scraped": 8,
                },
            },
        )
    )
    await db_session.commit()

    response = await api_client.get(
        f"/api/agents/{agent.id}/send-logs",
        params={"job_id": 1},
        headers={
            "X-Telegram-Init-Data": _webapp_init_data(user_id=9901),
            "X-App-Boundary": "admin",
        },
    )
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["logs"]) == 1
    row = payload["logs"][0]
    # scraper_members has no group_info; falls back to the tg_group_id string.
    assert row["group_title"] == str(-100234004)
    assert "members: 8" in row["message_preview"]
    assert "messages:" not in row["message_preview"]
