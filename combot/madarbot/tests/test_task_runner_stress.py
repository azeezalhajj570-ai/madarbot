"""Stress-test the task runner pipeline: message → engine → agent job → lead capture."""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from bot.agents.service import AgentService
from bot.automation.models import TaskAssignment, TaskEvent
from bot.automation.registry import build_default_registry
from bot.automation.engine import TaskEngine
from bot.automation.executors import AgentJobExecutor
from bot.automation.conditions import ConditionEvaluator
from bot.db.models import Agent, AgentJob, AgentLead, Group, GroupAdminRole, User
from bot.services.task_service import TaskService


class _TrackingDispatch:
    def __init__(self):
        self.job_ids: list[int] = []
        self.count = 0

    async def __call__(self, job_id: int) -> None:
        self.count += 1
        self.job_ids.append(job_id)


@pytest.mark.asyncio
async def test_task_engine_handles_high_message_rate(db_session, fake_redis) -> None:
    """Verify task engine processes messages without rate-limit bottlenecks."""
    user = User(tg_user_id=7001, username="stresstest", full_name="Stress Tester", language_code="en")
    db_session.add(user)
    await db_session.flush()

    group = Group(tg_group_id=-1007001, title="Stress Test Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9100,
        external_account_id="stress-agent",
        status="active",
        auth_state="active",
        session_string="session:stress",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    item_count = 200
    tracking = _TrackingDispatch()
    registry = build_default_registry()
    engine = TaskEngine(registry=registry, condition_evaluator=ConditionEvaluator())

    executors = {
        "agent": AgentJobExecutor(AgentService(db_session), tracking),
    }

    lead_assign = TaskAssignment(
        assignment_id="stress-lead-1",
        task_key="lead_capture",
        executor_type="agent",
        enabled=True,
        conditions={"text_contains_any": ["buy", "price", "interested", "help"]},
        config={"ack_template": "Thanks!", "lead_label": "sales"},
        agent_id=agent.id,
        group_tg_ids=[-1007001],
    )
    reply_assign = TaskAssignment(
        assignment_id="stress-reply-1",
        task_key="reply_message",
        executor_type="agent",
        enabled=True,
        conditions={"text_contains_any": ["help", "support", "question"]},
        config={"message_template": "Reply", "reply_mode": "private"},
        agent_id=agent.id,
        group_tg_ids=[-1007001],
    )
    all_assignments = [lead_assign, reply_assign]

    batch_start = time.monotonic()
    for i in range(item_count):
        event = TaskEvent(
            name="message.received",
            group_id=group.id,
            user_id=7000 + i % 100,
            payload={
                "chat_id": -1007001,
                "group_title": "Stress Test Group",
                "text": f"User {i}: I need help with support question #{i}",
                "message_id": i + 1000,
                "first_name": f"User{i % 100}",
                "username": f"user{i % 100}",
            },
        )
        await engine.process(all_assignments, event, executors)

    duration = time.monotonic() - batch_start
    msg_per_sec = item_count / duration if duration > 0 else 0
    print(f"\n  Sequential: {item_count} msgs × {len(all_assignments)} tasks = {item_count*len(all_assignments)} evals | {duration:.3f}s | {msg_per_sec:.0f} msg/s | {tracking.count} jobs dispatched")
    assert tracking.count > 0, "Expected at least some jobs to be dispatched"


@pytest.mark.asyncio
async def test_lead_capture_creates_leads_from_messages(db_session, fake_redis) -> None:
    """End-to-end test: message with keywords → task engine → agent jobs created."""
    user = User(tg_user_id=7002, username="leadtester", full_name="Lead Tester", language_code="en")
    db_session.add(user)
    await db_session.flush()

    group = Group(tg_group_id=-1007002, title="Lead Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9101,
        external_account_id="lead-agent",
        status="active",
        auth_state="active",
        session_string="session:lead",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    tracking = _TrackingDispatch()
    service = TaskService(
        db_session,
        dispatch_agent_job=tracking,
        dispatch_follow_up=AsyncMock(),
        dispatch_delete_message=AsyncMock(),
    )

    assignment = TaskAssignment(
        assignment_id="lead-cap-1",
        task_key="lead_capture",
        executor_type="agent",
        enabled=True,
        conditions={"text_contains_any": ["buy", "price", "สนใจ"]},
        config={"ack_template": "Thanks!", "lead_label": "sales"},
        agent_id=agent.id,
        group_tg_ids=[-1007002],
    )
    await service.store.upsert_assignment(group.id, assignment)

    messages = [
        {"user_id": 8001, "text": "I'm interested in buying this product", "username": "buyer1"},
        {"user_id": 8002, "text": "What is the price for the premium plan?", "username": "buyer2"},
        {"user_id": 8003, "text": "สนใจสินค้าครับ", "username": "buyer3"},
        {"user_id": 8004, "text": "Random chat message", "username": "chatter"},
        {"user_id": 8005, "text": "price check on the new version?", "username": "buyer5"},
    ]

    for msg in messages:
        await service.handle_message_event(
            group_id=group.id,
            user_id=msg["user_id"],
            payload={
                "chat_id": -1007002,
                "group_title": "Lead Group",
                "text": msg["text"],
                "message_id": 2000 + msg["user_id"],
                "first_name": msg["username"],
                "username": msg["username"],
                "bot": None,
                "contains_link": False,
                "lang": "en",
            },
        )

    assert tracking.count == 4, f"Expected 4 agent jobs, got {tracking.count}"

    jobs = (await db_session.execute(
        select(AgentJob).where(AgentJob.id.in_(tracking.job_ids))
    )).scalars().all()
    assert len(jobs) == 4
    task_keys = {job.job_payload.get("task_key") for job in jobs}
    assert task_keys == {"lead_capture"}


@pytest.mark.asyncio
async def test_task_engine_rate_limit_throttles_messages(db_session, fake_redis) -> None:
    """Verify rate limiter throttles automation when per-group limit hit."""
    user = User(tg_user_id=7003, username="rluser", full_name="Rate Limit", language_code="en")
    db_session.add(user)
    await db_session.flush()
    group = Group(tg_group_id=-1007003, title="Rate Limit Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9102,
        external_account_id="rl-agent",
        status="active",
        auth_state="active",
        session_string="session:rl",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    from bot.utils.rate_limiter import ApiRateLimiter
    limiter = ApiRateLimiter(fake_redis)
    fake_redis.incr = AsyncMock(return_value=11)
    engine = TaskEngine(
        registry=build_default_registry(),
        condition_evaluator=ConditionEvaluator(),
        rate_limiter=limiter,
        rate_limit_per_group_minute=10,
    )

    dispatch = _TrackingDispatch()
    executors = {"agent": AgentJobExecutor(AgentService(db_session), dispatch)}
    assignment = TaskAssignment(
        assignment_id="rl-1",
        task_key="reply_message",
        executor_type="agent",
        enabled=True,
        conditions={"has_text": True},
        config={"message_template": "Reply {text}"},
        agent_id=agent.id,
        group_tg_ids=[-1007003],
    )

    event = TaskEvent(
        name="message.received",
        group_id=group.id,
        user_id=7003,
        payload={"chat_id": -1007003, "text": "Hello", "message_id": 1, "first_name": "Test", "username": "test"},
    )

    results = await engine.process([assignment], event, executors)
    assert len(results) == 0, "Expected rate limit to block execution"


@pytest.mark.asyncio
async def test_large_message_handling(db_session, fake_redis) -> None:
    """Verify task engine handles large message payloads without crashing."""
    user = User(tg_user_id=7004, username="largemsg", full_name="Large Msg", language_code="en")
    db_session.add(user)
    await db_session.flush()
    group = Group(tg_group_id=-1007004, title="Large Message Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9103,
        external_account_id="large-msg-agent",
        status="active",
        auth_state="active",
        session_string="session:large",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    dispatch = _TrackingDispatch()
    engine = TaskEngine(registry=build_default_registry(), condition_evaluator=ConditionEvaluator())
    executors = {"agent": AgentJobExecutor(AgentService(db_session), dispatch)}

    assignment = TaskAssignment(
        assignment_id="large-1",
        task_key="reply_message",
        executor_type="agent",
        enabled=True,
        conditions={"has_text": True},
        config={"message_template": "Got your large message: {text}"},
        agent_id=agent.id,
        group_tg_ids=[-1007004],
    )

    LARGE_TEXT = "Hello " * 10000 + "buy support help"
    event = TaskEvent(
        name="message.received",
        group_id=group.id,
        user_id=7004,
        payload={
            "chat_id": -1007004,
            "group_title": "Large Message Group",
            "text": LARGE_TEXT,
            "message_id": 42,
            "first_name": "Large",
            "username": "largemsg",
        },
    )

    results = await engine.process([assignment], event, executors)
    assert len(results) == 1
    assert results[0].assignment.assignment_id == "large-1"
    assert dispatch.count == 1


@pytest.mark.asyncio
async def test_concurrent_sequential_processing(db_session, fake_redis) -> None:
    """Verify multiple assignments process correctly (sequential by design)."""
    user = User(tg_user_id=7005, username="concurrent", full_name="Concurrent", language_code="en")
    db_session.add(user)
    await db_session.flush()
    group = Group(tg_group_id=-1007005, title="Concurrent Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9106,
        external_account_id="concurrent-agent",
        status="active",
        auth_state="active",
        session_string="session:concurrent",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    COUNT = 5
    assignments = []
    for i in range(COUNT):
        assignments.append(TaskAssignment(
            assignment_id=f"c-{i}",
            task_key="reply_message",
            executor_type="agent",
            enabled=True,
            conditions={"has_text": True},
            config={"message_template": f"Reply #{i}: {{text}}", "reply_mode": "public"},
            agent_id=agent.id,
            group_tg_ids=[-1007005],
        ))

    dispatch = _TrackingDispatch()
    engine = TaskEngine(registry=build_default_registry(), condition_evaluator=ConditionEvaluator())
    executors = {"agent": AgentJobExecutor(AgentService(db_session), dispatch)}

    start = time.monotonic()
    for i in range(50):
        event = TaskEvent(
            name="message.received",
            group_id=group.id,
            user_id=7005 + i % 5,
            payload={
                "chat_id": -1007005,
                "text": f"concurrent message #{i} buy help support",
                "message_id": 3000 + i,
                "first_name": f"User{i}",
                "username": f"u{i}",
            },
        )
        await engine.process(assignments, event, executors)
    elapsed = time.monotonic() - start
    msg_rate = 50 / elapsed if elapsed > 0 else 0
    print(f"\n  Sequential batch: 50 msgs × {COUNT} tasks = {50*COUNT} evals | {elapsed:.3f}s | {msg_rate:.0f} msg/s | {dispatch.count} dispatched")
    assert dispatch.count == 50 * COUNT


@pytest.mark.asyncio
async def test_agent_task_runtime_lead_capture_flow(db_session, fake_redis) -> None:
    """Test that AgentTaskRuntime actually creates AgentLead records."""
    from unittest.mock import AsyncMock, patch
    from bot.agents.runtime import AgentTaskRuntime

    user = User(tg_user_id=7006, username="runtimelead", full_name="Runtime Lead", language_code="en")
    db_session.add(user)
    await db_session.flush()
    group = Group(tg_group_id=-1007006, title="Runtime Lead Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()

    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9104,
        external_account_id="runtime-agent",
        status="active",
        auth_state="active",
        session_string="session:runtime",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    runtime = AgentTaskRuntime(registry=build_default_registry())

    class FakeMessage:
        id = 99999

    fake_client = AsyncMock()
    fake_client.send_message = AsyncMock(return_value=FakeMessage())
    fake_client.delete_messages = AsyncMock()

    job_payload = {
        "task_key": "lead_capture",
        "assignment_id": "runtime-lead-cap-1",
        "task_config": {"ack_template": "Thanks {first_name}!", "lead_label": "vip"},
        "event": {
            "name": "message.received",
            "group_id": group.id,
            "user_id": 9001,
            "payload": {
                "chat_id": -1007006,
                "group_title": "Runtime Lead Group",
                "text": "I'd like to buy the premium plan please",
                "message_id": 5001,
                "first_name": "Premium",
                "full_name": "Premium Buyer",
                "username": "premiumbuyer",
            },
        },
    }

    job = AgentJob(
        agent_id=agent.id,
        job_type="automation_task",
        job_payload=job_payload,
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    with patch("redis.asyncio.Redis.from_url") as mock_from_url:
        fake_redis.incr = AsyncMock(return_value=1)
        fake_redis.expire = AsyncMock()
        fake_redis.get = AsyncMock(return_value=None)
        fake_redis.ttl = AsyncMock(return_value=-2)
        fake_redis.set = AsyncMock()
        fake_redis.aclose = AsyncMock()
        mock_from_url.return_value = fake_redis

        result = await runtime.execute(
            client=fake_client,
            agent=agent,
            job=job,
            session=db_session,
        )

    assert result is True

    leads = (await db_session.execute(
        select(AgentLead).where(AgentLead.agent_id == agent.id)
    )).scalars().all()

    assert len(leads) == 1, f"Expected 1 lead, got {len(leads)}"
    lead = leads[0]
    assert lead.tg_user_id == 9001
    assert lead.lead_label == "vip"
    assert lead.username == "premiumbuyer"
    assert lead.source_group_tg_id == -1007006


@pytest.mark.asyncio
async def test_task_engine_stress_with_varied_conditions(db_session, fake_redis) -> None:
    """Stress test: many task types with varied conditions on many messages."""
    user = User(tg_user_id=7007, username="varied", full_name="Varied Stress", language_code="en")
    db_session.add(user)
    await db_session.flush()
    group = Group(tg_group_id=-1007007, title="Varied Group", owner_user_id=user.id, is_active=True)
    db_session.add(group)
    await db_session.flush()
    db_session.add(GroupAdminRole(group_id=group.id, user_id=user.tg_user_id, role="owner"))
    agent = Agent(
        group_id=group.id,
        linked_by_user_id=user.tg_user_id,
        telegram_user_id=9105,
        external_account_id="varied-agent",
        status="active",
        auth_state="active",
        session_string="session:varied",
        details={},
    )
    db_session.add(agent)
    await db_session.commit()

    all_assignments = [
        TaskAssignment(assignment_id="v-reply-1", task_key="reply_message", executor_type="agent", enabled=True,
            conditions={"text_contains_any": ["help", "support"]}, config={"message_template": "Support: {text}"}, agent_id=agent.id, group_tg_ids=[-1007007]),
        TaskAssignment(assignment_id="v-lead-1", task_key="lead_capture", executor_type="agent", enabled=True,
            conditions={"text_contains_any": ["buy", "price"]}, config={"ack_template": "Lead noted", "lead_label": "general"}, agent_id=agent.id, group_tg_ids=[-1007007]),
        TaskAssignment(assignment_id="v-welcome-1", task_key="welcome_flow", executor_type="agent", enabled=False,
            conditions={}, config={"message_template": "Welcome!"}, agent_id=agent.id, group_tg_ids=[-1007007]),
        TaskAssignment(assignment_id="v-escalation-1", task_key="escalation_alert", executor_type="agent", enabled=True,
            conditions={"text_contains_any": ["urgent", "emergency"]}, config={"message_template": "Escalating: {text}"}, agent_id=agent.id, group_tg_ids=[-1007007]),
        TaskAssignment(assignment_id="v-notify-1", task_key="notify_destination", executor_type="agent", enabled=True,
            conditions={"text_contains_any": ["notify", "alert"]}, config={"message_template": "Alert: {text}", "destination": "-1008000", "delivery_mode": "text"}, agent_id=agent.id, group_tg_ids=[-1007007]),
    ]

    dispatch = _TrackingDispatch()
    engine = TaskEngine(registry=build_default_registry(), condition_evaluator=ConditionEvaluator())
    executors = {"agent": AgentJobExecutor(AgentService(db_session), dispatch)}

    messages = [
        "help me with this issue please",    # matches reply_message
        "I want to buy premium plan",        # matches lead_capture
        "urgent emergency help needed",      # matches reply_message + escalation_alert
        "please notify the team now",        # matches notify_destination
        "random chat no keywords here",      # no match
        "buy the alert plan price",          # matches lead_capture + notify_destination
        "support ticket #1234",              # matches reply_message
        "this is just a test",               # no match
        "alert: server down notify admin",   # matches notify_destination
        "price for bulk purchase",           # matches lead_capture
    ]

    start = time.monotonic()
    for text in messages:
        event = TaskEvent(
            name="message.received", group_id=group.id, user_id=7000 + hash(text) % 100,
            payload={"chat_id": -1007007, "text": text, "message_id": hash(text) % 10000, "first_name": "Tester", "username": "test"},
        )
        await engine.process(all_assignments, event, executors)

    elapsed = time.monotonic() - start
    print(f"\n  Varied: {len(messages)} msgs × {len(all_assignments)} tasks = {len(messages)*len(all_assignments)} evals | {elapsed:.3f}s | {dispatch.count} dispatched")
    assert dispatch.count >= 8
