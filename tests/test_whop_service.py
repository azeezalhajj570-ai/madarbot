from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from bot.config import get_settings
from bot.dashboard.api.main import app
from bot.db.models import (
    SubscriptionRequest,
    SubscriptionStatus,
    WhopOrder,
    WhopWebhookEvent,
)
from bot.services.whop_service import (
    WhopError,
    WhopService,
    WhopSignatureError,
    verify_webhook_signature,
)

WEBHOOK_SECRET = "ws_" + base64.b64encode(b"whop-test-secret").decode()


@pytest.fixture
def whop_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WHOP_ENABLED", "true")
    monkeypatch.setenv("WHOP_API_KEY", "apik_test")
    monkeypatch.setenv("WHOP_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("WHOP_COMPANY_ID", "biz_test")
    monkeypatch.setenv("WHOP_PLAN_ID_PRO", "plan_pro")
    monkeypatch.setenv("WHOP_PLAN_ID_BUSINESS", "plan_business")
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


class FakeWhopClient:
    """Records calls and returns canned Whop payloads (no network)."""

    def __init__(self) -> None:
        self.checkout_payloads: list[dict] = []
        self.memberships: dict[str, dict] = {}
        self.cancelled: list[str] = []

    async def create_checkout_configuration(self, *, plan_id, metadata, redirect_url=None):
        payload = {
            "plan_id": plan_id,
            "metadata": metadata,
            "redirect_url": redirect_url,
        }
        self.checkout_payloads.append(payload)
        return {"id": "ch_test_1", "purchase_url": "/checkout/ch_test_1/"}

    async def get_membership(self, membership_id):
        return self.memberships.get(membership_id, {})

    async def cancel_membership(self, membership_id, *, at_period_end=True):
        self.cancelled.append(membership_id)
        return {"id": membership_id, "status": "canceled"}


def _sign(body: bytes, *, secret: str = WEBHOOK_SECRET, webhook_id: str = "msg_1", timestamp=None):
    ts = str(timestamp if timestamp is not None else int(time.time()))
    key = base64.b64decode(secret[len("ws_") :])
    signature = base64.b64encode(
        hmac.new(key, f"{webhook_id}.{ts}.".encode() + body, hashlib.sha256).digest()
    ).decode()
    return {
        "webhook-id": webhook_id,
        "webhook-timestamp": ts,
        "webhook-signature": f"v1,{signature}",
    }


# ─── signature verification ──────────────────────────────────────────────────


def test_signature_accepts_valid_whop_secret() -> None:
    body = b'{"type":"payment.succeeded"}'
    verify_webhook_signature(raw_body=body, headers=_sign(body), secret=WEBHOOK_SECRET)


def test_signature_accepts_raw_secret_encoding() -> None:
    """Whop's docs describe the ws_ secret as the key itself, so accept both."""
    body = b'{"type":"payment.succeeded"}'
    ts = str(int(time.time()))
    signature = base64.b64encode(
        hmac.new(WEBHOOK_SECRET.encode(), f"msg_1.{ts}.".encode() + body, hashlib.sha256).digest()
    ).decode()
    verify_webhook_signature(
        raw_body=body,
        headers={
            "webhook-id": "msg_1",
            "webhook-timestamp": ts,
            "webhook-signature": f"v1,{signature}",
        },
        secret=WEBHOOK_SECRET,
    )


def test_signature_rejects_tampered_body() -> None:
    body = b'{"type":"payment.succeeded"}'
    headers = _sign(body)
    with pytest.raises(WhopSignatureError):
        verify_webhook_signature(
            raw_body=b'{"type":"payment.succeeded","extra":true}',
            headers=headers,
            secret=WEBHOOK_SECRET,
        )


def test_signature_rejects_wrong_secret() -> None:
    body = b"{}"
    headers = _sign(body, secret="ws_" + base64.b64encode(b"other-secret").decode())
    with pytest.raises(WhopSignatureError):
        verify_webhook_signature(raw_body=body, headers=headers, secret=WEBHOOK_SECRET)


def test_signature_rejects_stale_timestamp() -> None:
    body = b"{}"
    headers = _sign(body, timestamp=int(time.time()) - 3600)
    with pytest.raises(WhopSignatureError):
        verify_webhook_signature(raw_body=body, headers=headers, secret=WEBHOOK_SECRET)


def test_signature_rejects_missing_headers() -> None:
    with pytest.raises(WhopSignatureError):
        verify_webhook_signature(raw_body=b"{}", headers={}, secret=WEBHOOK_SECRET)


def test_parse_datetime_accepts_utc_z_suffix() -> None:
    """Whop sends some timestamps with a trailing Z."""
    from bot.services.whop_service import _parse_datetime

    assert _parse_datetime("2026-10-01T12:00:00Z") == datetime(
        2026, 10, 1, 12, 0, tzinfo=timezone.utc
    )
    assert _parse_datetime("2026-10-01T12:00:00") == datetime(
        2026, 10, 1, 12, 0, tzinfo=timezone.utc
    )
    assert _parse_datetime(None) is None
    assert _parse_datetime("not-a-date") is None


# ─── checkout ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_checkout_records_order_with_metadata(db_session, whop_settings) -> None:
    client = FakeWhopClient()
    service = WhopService(db_session, client=client)

    order, url = await service.create_checkout(
        tg_user_id=555, plan="pro", tenant_id=7, redirect_url="https://app.test/webapp/agents"
    )

    assert url == "https://whop.com/checkout/ch_test_1/"
    assert order.status == "pending"
    assert order.whop_checkout_id == "ch_test_1"

    sent = client.checkout_payloads[0]
    assert sent["plan_id"] == "plan_pro"
    assert sent["metadata"]["order_id"] == order.order_id
    assert sent["metadata"]["tg_user_id"] == "555"
    assert sent["metadata"]["tenant_id"] == "7"


@pytest.mark.asyncio
async def test_create_checkout_requires_configured_plan(
    db_session, whop_settings, monkeypatch
) -> None:
    monkeypatch.setenv("WHOP_PLAN_ID_BUSINESS", "")
    get_settings.cache_clear()
    service = WhopService(db_session, client=FakeWhopClient())

    with pytest.raises(WhopError):
        await service.create_checkout(tg_user_id=555, plan="business")


# ─── fulfillment ─────────────────────────────────────────────────────────────


async def _pending_order(service: WhopService, db_session, *, plan: str = "pro") -> WhopOrder:
    order, _ = await service.create_checkout(tg_user_id=555, plan=plan)
    return order


def _payment_event(order: WhopOrder, *, membership_id: str = "memb_1", period_end: datetime):
    return {
        "type": "payment.succeeded",
        "data": {
            "id": "pay_1",
            "membership_id": membership_id,
            "metadata": {
                "order_id": order.order_id,
                "tg_user_id": str(order.tg_user_id),
                "plan": order.plan,
            },
            "valid_until": period_end.isoformat(),
            "status": "active",
        },
    }


@pytest.mark.asyncio
async def test_payment_succeeded_grants_access(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)

    outcome = await service.handle_webhook(
        event=_payment_event(order, period_end=period_end), webhook_id="msg_pay_1"
    )

    assert outcome == "fulfilled"
    await db_session.refresh(order)
    assert order.status == "active"
    assert order.whop_payment_id == "pay_1"
    assert order.whop_membership_id == "memb_1"
    assert order.paid_at is not None
    assert order.subscription_request_id is not None

    subscription = await db_session.get(SubscriptionRequest, order.subscription_request_id)
    assert subscription is not None
    assert subscription.status == SubscriptionStatus.APPROVED.value
    assert subscription.plan == "pro"
    assert subscription.bot_kind == "agents"
    assert subscription.expires_at is not None


@pytest.mark.asyncio
async def test_membership_activated_during_trial_marks_trialing(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    trial_end = datetime.now(timezone.utc) + timedelta(days=7)

    outcome = await service.handle_webhook(
        event={
            "type": "membership.activated",
            "data": {
                "id": "memb_trial",
                "status": "trialing",
                "trial_end": trial_end.isoformat(),
                "metadata": {"order_id": order.order_id, "tg_user_id": "555", "plan": "pro"},
            },
        },
        webhook_id="msg_trial_1",
    )

    assert outcome == "fulfilled"
    await db_session.refresh(order)
    assert order.status == "trialing"
    subscription = await db_session.get(SubscriptionRequest, order.subscription_request_id)
    assert subscription is not None
    assert subscription.expires_at.replace(tzinfo=timezone.utc) == trial_end


@pytest.mark.asyncio
async def test_duplicate_webhook_is_processed_once(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    event = _payment_event(order, period_end=period_end)

    first = await service.handle_webhook(event=event, webhook_id="msg_dup")
    second = await service.handle_webhook(event=event, webhook_id="msg_dup")

    assert first == "fulfilled"
    assert second == "duplicate"

    subscriptions = (
        (
            await db_session.execute(
                select(SubscriptionRequest).where(SubscriptionRequest.tg_user_id == 555)
            )
        )
        .scalars()
        .all()
    )
    assert len(subscriptions) == 1
    deliveries = (await db_session.execute(select(WhopWebhookEvent))).scalars().all()
    assert len(deliveries) == 1


@pytest.mark.asyncio
async def test_renewal_extends_existing_subscription(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)

    first_end = datetime.now(timezone.utc) + timedelta(days=30)
    await service.handle_webhook(
        event=_payment_event(order, period_end=first_end), webhook_id="msg_renew_1"
    )
    await db_session.refresh(order)
    subscription_id = order.subscription_request_id

    second_end = datetime.now(timezone.utc) + timedelta(days=60)
    await service.handle_webhook(
        event=_payment_event(order, period_end=second_end), webhook_id="msg_renew_2"
    )

    await db_session.refresh(order)
    # A renewal extends the same row rather than stacking a second one.
    assert order.subscription_request_id == subscription_id
    subscription = await db_session.get(SubscriptionRequest, subscription_id)
    assert subscription.expires_at.replace(tzinfo=timezone.utc) == second_end

    count = len(
        (
            await db_session.execute(
                select(SubscriptionRequest).where(SubscriptionRequest.tg_user_id == 555)
            )
        )
        .scalars()
        .all()
    )
    assert count == 1


@pytest.mark.asyncio
async def test_membership_deactivated_revokes_access(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    await service.handle_webhook(
        event=_payment_event(order, membership_id="memb_x", period_end=period_end),
        webhook_id="msg_grant",
    )
    await db_session.refresh(order)

    outcome = await service.handle_webhook(
        event={
            "type": "membership.deactivated",
            "data": {"id": "memb_x", "status": "canceled", "metadata": {}},
        },
        webhook_id="msg_revoke",
    )

    assert outcome == "revoked"
    await db_session.refresh(order)
    assert order.status == "cancelled"
    subscription = await db_session.get(SubscriptionRequest, order.subscription_request_id)
    assert subscription.status == SubscriptionStatus.CANCELLED.value


@pytest.mark.asyncio
async def test_payment_failed_marks_order_past_due(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)

    outcome = await service.handle_webhook(
        event={
            "type": "payment.failed",
            "data": {
                "id": "pay_failed",
                "membership_id": "memb_1",
                "metadata": {"order_id": order.order_id},
            },
        },
        webhook_id="msg_failed",
    )

    assert outcome == "past_due"
    await db_session.refresh(order)
    assert order.status == "past_due"


@pytest.mark.asyncio
async def test_unknown_event_is_ignored(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    outcome = await service.handle_webhook(
        event={"type": "app_updated", "data": {}}, webhook_id="m1"
    )
    assert outcome == "ignored"


@pytest.mark.asyncio
async def test_order_matching_falls_back_to_membership_id(db_session, whop_settings) -> None:
    """A membership event without metadata still resolves via the membership id."""
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    await service.handle_webhook(
        event=_payment_event(
            order,
            membership_id="memb_fallback",
            period_end=datetime.now(timezone.utc) + timedelta(days=30),
        ),
        webhook_id="msg_fb_1",
    )

    outcome = await service.handle_webhook(
        event={"type": "membership.deactivated", "data": {"id": "memb_fallback"}},
        webhook_id="msg_fb_2",
    )
    assert outcome == "revoked"


# ─── sync + cancel ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_grants_access_from_whop_state(db_session, whop_settings) -> None:
    client = FakeWhopClient()
    service = WhopService(db_session, client=client)
    order = await _pending_order(service, db_session)
    order.whop_membership_id = "memb_sync"
    await db_session.commit()

    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    client.memberships["memb_sync"] = {
        "id": "memb_sync",
        "status": "active",
        "valid_until": period_end.isoformat(),
    }

    synced = await service.sync_order(tg_user_id=555)

    assert synced is not None
    assert synced.status == "active"
    subscription = await db_session.get(SubscriptionRequest, synced.subscription_request_id)
    assert subscription.status == SubscriptionStatus.APPROVED.value


@pytest.mark.asyncio
async def test_sync_revokes_when_membership_invalid(db_session, whop_settings) -> None:
    client = FakeWhopClient()
    service = WhopService(db_session, client=client)
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    await service.handle_webhook(
        event=_payment_event(order, membership_id="memb_dead", period_end=period_end),
        webhook_id="msg_sync_revoke",
    )
    client.memberships["memb_dead"] = {"id": "memb_dead", "status": "expired"}

    synced = await service.sync_order(tg_user_id=555)

    assert synced is not None
    assert synced.status == "cancelled"
    subscription = await db_session.get(SubscriptionRequest, synced.subscription_request_id)
    assert subscription.status == SubscriptionStatus.CANCELLED.value


@pytest.mark.asyncio
async def test_cancel_keeps_access_until_period_end(db_session, whop_settings) -> None:
    client = FakeWhopClient()
    service = WhopService(db_session, client=client)
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    await service.handle_webhook(
        event=_payment_event(order, membership_id="memb_cancel", period_end=period_end),
        webhook_id="msg_cancel_grant",
    )

    result = await service.cancel_subscription(tg_user_id=555)

    assert client.cancelled == ["memb_cancel"]
    assert result.cancel_at_period_end is True
    subscription = await db_session.get(SubscriptionRequest, result.subscription_request_id)
    # Access is not cut short for a cancellation at period end.
    assert subscription.status == SubscriptionStatus.APPROVED.value


@pytest.mark.asyncio
async def test_cancel_without_subscription_raises(db_session, whop_settings) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    with pytest.raises(WhopError):
        await service.cancel_subscription(tg_user_id=999)


# ─── webhook endpoint (HTTP) ─────────────────────────────────────────────────


@pytest_asyncio.fixture(autouse=True)
async def _reset_rate_limit_redis():
    """Drop pooled Redis connections between tests.

    ``app.state.redis`` is created at import time and its pool binds to the loop
    of whichever test first uses it. pytest-asyncio gives each test a fresh loop,
    so the pool would later try to disconnect connections owned by a closed loop
    ("Event loop is closed"). Closing it per test re-connects lazily instead.
    """
    yield
    redis = getattr(app.state, "redis", None)
    if redis is not None:
        try:
            await redis.aclose()
        except Exception:  # noqa: BLE001 - best-effort teardown
            pass


@pytest_asyncio.fixture
async def api_client(patch_db_dependencies, whop_settings) -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _post_headers(body: bytes, **overrides) -> dict[str, str]:
    return {"content-type": "application/json", **_sign(body, **overrides)}


@pytest.mark.asyncio
async def test_webhook_endpoint_rejects_bad_signature(api_client: AsyncClient) -> None:
    body = json.dumps({"type": "payment.succeeded", "data": {}}).encode()
    response = await api_client.post(
        "/api/webhooks/whop",
        content=body,
        headers={
            "content-type": "application/json",
            "webhook-id": "msg_bad",
            "webhook-timestamp": str(int(time.time())),
            "webhook-signature": "v1,not-a-real-signature",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_webhook_endpoint_rejects_missing_headers(api_client: AsyncClient) -> None:
    response = await api_client.post(
        "/api/webhooks/whop", content=b"{}", headers={"content-type": "application/json"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_webhook_rejects_when_secret_missing(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("WHOP_WEBHOOK_SECRET", "")
    get_settings.cache_clear()
    body = json.dumps({"type": "payment.succeeded", "data": {}}).encode()
    response = await api_client.post(
        "/api/webhooks/whop", content=body, headers=_post_headers(body)
    )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_webhook_still_fulfills_while_sales_are_disabled(
    api_client: AsyncClient, db_session, whop_settings, monkeypatch
) -> None:
    """Pausing new sales must not stop renewals/cancellations being honoured."""
    monkeypatch.setenv("WHOP_ENABLED", "false")
    get_settings.cache_clear()

    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    body = json.dumps(
        _payment_event(order, membership_id="memb_off", period_end=period_end)
    ).encode()

    response = await api_client.post(
        "/api/webhooks/whop", content=body, headers=_post_headers(body)
    )

    assert response.status_code == 200
    assert response.json()["outcome"] == "fulfilled"
    await db_session.refresh(order)
    assert order.status == "active"


@pytest.mark.asyncio
async def test_webhook_endpoint_fulfills_signed_delivery(
    api_client: AsyncClient, db_session, whop_settings
) -> None:
    service = WhopService(db_session, client=FakeWhopClient())
    order = await _pending_order(service, db_session)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    body = json.dumps(
        _payment_event(order, membership_id="memb_http", period_end=period_end)
    ).encode()

    response = await api_client.post(
        "/api/webhooks/whop", content=body, headers=_post_headers(body)
    )

    assert response.status_code == 200
    assert response.json()["outcome"] == "fulfilled"

    await db_session.refresh(order)
    assert order.status == "active"
    subscription = await db_session.get(SubscriptionRequest, order.subscription_request_id)
    assert subscription.status == SubscriptionStatus.APPROVED.value

    # Replaying the same delivery must not grant twice.
    replay = await api_client.post("/api/webhooks/whop", content=body, headers=_post_headers(body))
    assert replay.status_code == 200
    assert replay.json()["outcome"] == "duplicate"

    count = len(
        (
            await db_session.execute(
                select(SubscriptionRequest).where(
                    SubscriptionRequest.tg_user_id == order.tg_user_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert count == 1
