"""Whop payments for the agents mini app.

Three responsibilities:

1. ``WhopClient`` — thin HTTP client for the Whop API (create a checkout
   configuration, read a membership, cancel a membership).
2. ``verify_webhook_signature`` — Standard Webhooks HMAC verification, which
   Whop uses for its webhook deliveries.
3. ``WhopService`` — the fulfillment state machine. It writes our own
   ``WhopOrder`` before the buyer ever sees the checkout form (so the checkout's
   ``metadata`` carries our ``order_id``), and on each webhook it grants,
   extends, or revokes the ``SubscriptionRequest`` row that gates access.

Access always lands on the legacy ``subscription_requests`` row for
``(tg_user_id, bot_kind="agents")`` so every existing plan gate keeps working
without changes.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models import (
    SubscriptionRequest,
    SubscriptionStatus,
    WhopOrder,
    WhopWebhookEvent,
)

logger = logging.getLogger(__name__)

BOT_KIND = "agents"
PLAN_TIERS = ("pro", "business")
WEBHOOK_TOLERANCE_SECONDS = 300

# Whop's exact field names for a membership's period end are not pinned down in
# their published docs, so read the first one we recognise and fall back to a
# computed period (see ``_resolve_period_end``).
_PERIOD_END_KEYS = (
    "valid_until",
    "expiration_date",
    "expires_at",
    "current_period_end",
    "renewal_period_end",
    "renewal_end",
    "period_end",
)
_TRIAL_END_KEYS = ("trial_end", "trial_ends_at", "free_trial_end")
_VALID_MEMBERSHIP_STATUSES = {"active", "trialing", "completed"}


class WhopError(Exception):
    """Base class for Whop integration errors."""


class WhopSignatureError(WhopError):
    """The webhook delivery could not be verified."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on round-trip; treat naive values as UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_aware(value)
    if isinstance(value, (int, float)):
        # Whop returns unix timestamps for some date fields.
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            # Python 3.11+ fromisoformat accepts a trailing "Z".
            return _as_aware(datetime.fromisoformat(text))
        except ValueError:
            return None
    return None


def _first_datetime(payload: Mapping[str, Any], keys: tuple[str, ...]) -> datetime | None:
    for key in keys:
        parsed = _parse_datetime(payload.get(key))
        if parsed is not None:
            return parsed
    return None


def _candidate_keys(secret: str) -> list[bytes]:
    """Keys to try when verifying a signature.

    Standard Webhooks base64-decodes the ``whsec_`` secret before using it;
    Whop's docs show a ``ws_`` secret and describe it as the secret itself.
    Accepting both costs nothing and removes a guess from the deployment.
    """
    keys = [secret.encode("utf-8")]
    for prefix in ("whsec_", "ws_"):
        if secret.startswith(prefix):
            raw = secret[len(prefix) :]
            try:
                decoded = base64.b64decode(raw, validate=True)
            except (binascii.Error, ValueError):
                continue
            if decoded:
                keys.insert(0, decoded)
    return keys


def verify_webhook_signature(
    *,
    raw_body: bytes,
    headers: Mapping[str, str],
    secret: str,
    tolerance_seconds: int = WEBHOOK_TOLERANCE_SECONDS,
) -> None:
    """Raise WhopSignatureError unless the delivery is authentic.

    Implements the Standard Webhooks scheme: the signed content is
    ``{webhook-id}.{webhook-timestamp}.{body}`` and the header carries one or
    more space-separated ``v1,<base64 hmac>`` signatures.
    """
    normalized = {str(k).lower(): str(v) for k, v in headers.items()}
    webhook_id = normalized.get("webhook-id")
    timestamp = normalized.get("webhook-timestamp")
    signature_header = normalized.get("webhook-signature")

    if not webhook_id or not timestamp or not signature_header:
        raise WhopSignatureError("Missing webhook signature headers")

    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise WhopSignatureError("Invalid webhook timestamp") from exc

    if abs(int(_utcnow().timestamp()) - timestamp_value) > tolerance_seconds:
        raise WhopSignatureError("Webhook timestamp outside tolerance")

    provided = [
        part.split(",", 1)[1]
        for part in signature_header.split()
        if part.startswith("v1,") and "," in part
    ]
    if not provided:
        raise WhopSignatureError("No v1 signature in webhook-signature header")

    signed_content = f"{webhook_id}.{timestamp}.".encode() + raw_body
    for key in _candidate_keys(secret):
        expected = base64.b64encode(hmac.new(key, signed_content, hashlib.sha256).digest()).decode()
        for signature in provided:
            if hmac.compare_digest(expected, signature):
                return

    raise WhopSignatureError("Webhook signature mismatch")


class WhopClient:
    """Minimal async client for the Whop API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        account_id: str | None = None,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.account_id = account_id
        self.timeout = timeout
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
            transport=self._transport,
        )

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        async with self._client() as client:
            response = await client.request(method, path, **kwargs)
        if response.status_code >= 400:
            logger.warning(
                "whop_api_error method=%s path=%s status=%s body=%s",
                method,
                path,
                response.status_code,
                response.text[:500],
            )
            raise WhopError(
                f"Whop API {method} {path} failed with {response.status_code}: {response.text[:200]}"
            )
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise WhopError(f"Whop API {method} {path} returned invalid JSON") from exc

    async def create_checkout_configuration(
        self,
        *,
        plan_id: str,
        metadata: dict[str, str],
        redirect_url: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"plan_id": plan_id, "metadata": metadata, "mode": "payment"}
        if self.account_id:
            payload["account_id"] = self.account_id
        if redirect_url:
            payload["redirect_url"] = redirect_url
        return await self._request("POST", "/checkout_configurations", json=payload)

    async def get_membership(self, membership_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/memberships/{membership_id}")

    async def cancel_membership(
        self, membership_id: str, *, at_period_end: bool = True
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/memberships/{membership_id}/cancel",
            json={"cancellation_mode": "at_period_end" if at_period_end else "immediate"},
        )


class WhopService:
    def __init__(self, session: AsyncSession, client: WhopClient | None = None) -> None:
        self.session = session
        self.settings = get_settings()
        self._client = client

    # ─── client helpers ──────────────────────────────────────────────────────

    @property
    def configured(self) -> bool:
        return bool(self.settings.whop_api_key)

    def plan_id_for(self, plan: str) -> str | None:
        return {
            "pro": self.settings.whop_plan_id_pro,
            "business": self.settings.whop_plan_id_business,
        }.get(plan)

    def _get_client(self) -> WhopClient:
        if self._client is not None:
            return self._client
        if not self.settings.whop_api_key:
            raise WhopError("Whop is not configured (WHOP_API_KEY is unset).")
        self._client = WhopClient(
            api_key=self.settings.whop_api_key,
            base_url=self.settings.whop_api_base_url,
            account_id=self.settings.whop_company_id,
        )
        return self._client

    def _absolute_checkout_url(self, checkout: Mapping[str, Any]) -> str:
        base = self.settings.whop_checkout_base_url.rstrip("/")
        purchase_url = str(checkout.get("purchase_url") or "").strip()
        if purchase_url.startswith(("http://", "https://")):
            return purchase_url
        if purchase_url:
            return f"{base}/{purchase_url.lstrip('/')}"
        checkout_id = checkout.get("id")
        return f"{base}/checkout/{checkout_id}/"

    # ─── checkout ────────────────────────────────────────────────────────────

    async def create_checkout(
        self,
        *,
        tg_user_id: int,
        plan: str,
        tenant_id: int | None = None,
        redirect_url: str | None = None,
    ) -> tuple[WhopOrder, str]:
        """Record the order, create the Whop checkout, return (order, url)."""
        if plan not in PLAN_TIERS:
            raise WhopError(f"Unknown plan '{plan}'.")
        plan_id = self.plan_id_for(plan)
        if not plan_id:
            raise WhopError(f"Whop is not configured for the '{plan}' plan.")

        order = WhopOrder(
            order_id=uuid.uuid4().hex,
            tg_user_id=tg_user_id,
            tenant_id=tenant_id,
            plan=plan,
            status="pending",
            metadata_json={"plan": plan, "tg_user_id": str(tg_user_id)},
        )
        self.session.add(order)
        await self.session.commit()
        await self.session.refresh(order)

        metadata = {
            "order_id": order.order_id,
            "tg_user_id": str(tg_user_id),
            "plan": plan,
        }
        if tenant_id is not None:
            metadata["tenant_id"] = str(tenant_id)

        try:
            checkout = await self._get_client().create_checkout_configuration(
                plan_id=plan_id,
                metadata=metadata,
                redirect_url=redirect_url,
            )
        except WhopError:
            order.status = "failed"
            await self.session.commit()
            raise

        order.whop_checkout_id = checkout.get("id")
        await self.session.commit()
        logger.info(
            "whop_checkout_created order_id=%s tg_user_id=%s plan=%s checkout_id=%s",
            order.order_id,
            tg_user_id,
            plan,
            order.whop_checkout_id,
        )
        return order, self._absolute_checkout_url(checkout)

    # ─── webhooks ────────────────────────────────────────────────────────────

    async def handle_webhook(self, *, event: dict[str, Any], webhook_id: str) -> str:
        """Fulfill one webhook delivery exactly once.

        The delivery record is written in the same transaction as the work, so a
        duplicate finds the row and is skipped while a failed delivery leaves no
        row and is retried by Whop.
        """
        existing = await self.session.scalar(
            select(WhopWebhookEvent.id).where(WhopWebhookEvent.webhook_id == webhook_id)
        )
        if existing is not None:
            return "duplicate"

        event_type = str(event.get("type") or "")
        data = event.get("data") or {}
        if not isinstance(data, Mapping):
            data = {}

        outcome = await self._dispatch(event_type, data)

        self.session.add(
            WhopWebhookEvent(
                webhook_id=webhook_id,
                event_type=event_type,
                payload=event,
                processed_at=_utcnow(),
            )
        )
        await self.session.commit()
        logger.info(
            "whop_webhook_processed webhook_id=%s type=%s outcome=%s",
            webhook_id,
            event_type,
            outcome,
        )
        return outcome

    async def _dispatch(self, event_type: str, data: Mapping[str, Any]) -> str:
        if event_type == "payment.succeeded":
            return await self._handle_payment_succeeded(data)
        if event_type in {"membership.activated", "membership.went_valid"}:
            return await self._handle_membership_activated(data)
        if event_type in {"membership.deactivated", "membership.went_invalid"}:
            return await self._handle_membership_deactivated(data)
        if event_type in {"payment.failed", "payment.requires_action"}:
            return await self._handle_payment_failed(data)
        return "ignored"

    async def _find_order(self, data: Mapping[str, Any]) -> WhopOrder | None:
        metadata = data.get("metadata")
        if not isinstance(metadata, Mapping):
            metadata = {}
        order_id = metadata.get("order_id")
        if order_id:
            order = await self.session.scalar(
                select(WhopOrder).where(WhopOrder.order_id == str(order_id))
            )
            if order is not None:
                return order
        membership_id = data.get("membership_id") or data.get("id")
        if membership_id:
            return await self.session.scalar(
                select(WhopOrder).where(WhopOrder.whop_membership_id == str(membership_id))
            )
        return None

    def _resolve_period_end(self, membership: Mapping[str, Any], now: datetime) -> datetime:
        """Prefer Whop's own period end, else compute from trial/renewal length."""
        period_end = _first_datetime(membership, _PERIOD_END_KEYS)
        if period_end is not None:
            return period_end
        trial_end = _first_datetime(membership, _TRIAL_END_KEYS)
        if trial_end is not None and trial_end > now:
            return trial_end
        return now + timedelta(days=self.settings.whop_renewal_days)

    async def _handle_payment_succeeded(self, data: Mapping[str, Any]) -> str:
        order = await self._find_order(data)
        if order is None:
            logger.warning("whop_payment_succeeded_without_order payment_id=%s", data.get("id"))
            return "ignored"

        order.whop_payment_id = str(data.get("id") or order.whop_payment_id or "")
        order.paid_at = _utcnow()
        membership_id = data.get("membership_id") or data.get("membership")
        if isinstance(membership_id, Mapping):
            membership_id = membership_id.get("id")
        if membership_id:
            order.whop_membership_id = str(membership_id)

        membership: Mapping[str, Any] = {
            key: value
            for key, value in data.items()
            if key in _PERIOD_END_KEYS or key in _TRIAL_END_KEYS
        }
        if order.whop_membership_id:
            membership = await self._load_membership(order.whop_membership_id, fallback=membership)

        await self._grant_access(order, membership)
        return "fulfilled"

    async def _handle_membership_activated(self, data: Mapping[str, Any]) -> str:
        order = await self._find_order(data)
        if order is None:
            logger.warning(
                "whop_membership_activated_without_order membership_id=%s", data.get("id")
            )
            return "ignored"
        if data.get("id"):
            order.whop_membership_id = str(data["id"])
        await self._grant_access(order, data)
        return "fulfilled"

    async def _handle_membership_deactivated(self, data: Mapping[str, Any]) -> str:
        membership_id = str(data.get("id") or "")
        order = await self._find_order(data)
        if order is None and membership_id:
            order = await self.session.scalar(
                select(WhopOrder).where(WhopOrder.whop_membership_id == membership_id)
            )
        if order is None:
            logger.warning(
                "whop_membership_deactivated_without_order membership_id=%s", membership_id
            )
            return "ignored"

        status = str(data.get("status") or "").lower()
        if "expire" in status:
            order.status = "expired"
            reason = "Subscription expired"
        elif order.cancel_at_period_end or "cancel" in status:
            order.status = "cancelled"
            reason = "Subscription cancelled"
        else:
            order.status = "cancelled"
            reason = "Subscription ended"

        await self._revoke_access(order, reason=reason)
        return "revoked"

    async def _handle_payment_failed(self, data: Mapping[str, Any]) -> str:
        order = await self._find_order(data)
        if order is None:
            return "ignored"
        order.status = "past_due"
        order.whop_payment_id = str(data.get("id") or order.whop_payment_id or "")
        if data.get("membership_id"):
            order.whop_membership_id = str(data["membership_id"])
        logger.info("whop_payment_failed order_id=%s", order.order_id)
        return "past_due"

    async def _load_membership(
        self, membership_id: str, *, fallback: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        """Read authoritative membership state, falling back to the payload."""
        try:
            membership = await self._get_client().get_membership(membership_id)
        except WhopError as exc:
            logger.warning("whop_membership_fetch_failed id=%s error=%s", membership_id, exc)
            return fallback
        if not isinstance(membership, Mapping):
            return fallback
        # The API response wins, but a sparse response must not discard period
        # fields that only the webhook payload carried.
        merged = {**fallback, **membership}
        if not merged.get("metadata") and fallback.get("metadata"):
            merged["metadata"] = fallback["metadata"]
        return merged

    # ─── access ──────────────────────────────────────────────────────────────

    async def _grant_access(self, order: WhopOrder, membership: Mapping[str, Any]) -> None:
        now = _utcnow()
        period_end = self._resolve_period_end(membership, now)
        trial_end = _first_datetime(membership, _TRIAL_END_KEYS)

        subscription = None
        if order.subscription_request_id:
            subscription = await self.session.get(
                SubscriptionRequest, order.subscription_request_id
            )

        if subscription is not None and subscription.status == SubscriptionStatus.APPROVED.value:
            current_end = _as_aware(subscription.expires_at)
            if current_end is None or current_end < now:
                subscription.expires_at = period_end
            else:
                subscription.expires_at = max(current_end, period_end)
            subscription.plan = order.plan
            subscription.message = f"Whop subscription ({order.order_id})"
        else:
            subscription = SubscriptionRequest(
                tg_user_id=order.tg_user_id,
                status=SubscriptionStatus.APPROVED.value,
                plan=order.plan,
                expires_at=period_end,
                bot_kind=BOT_KIND,
                message=f"Whop subscription ({order.order_id})",
            )
            self.session.add(subscription)
            await self.session.flush()

        order.subscription_request_id = subscription.id
        order.current_period_end = period_end
        order.trial_end = trial_end
        order.cancel_at_period_end = False
        membership_status = str(membership.get("status") or "").lower()
        order.status = (
            "trialing"
            if membership_status == "trialing" or (trial_end is not None and trial_end > now)
            else "active"
        )
        await self.session.flush()
        logger.info(
            "whop_access_granted order_id=%s tg_user_id=%s plan=%s expires_at=%s status=%s",
            order.order_id,
            order.tg_user_id,
            order.plan,
            period_end.isoformat(),
            order.status,
        )

    async def _revoke_access(self, order: WhopOrder, *, reason: str) -> None:
        if order.subscription_request_id:
            subscription = await self.session.get(
                SubscriptionRequest, order.subscription_request_id
            )
            if (
                subscription is not None
                and subscription.status == SubscriptionStatus.APPROVED.value
            ):
                subscription.status = SubscriptionStatus.CANCELLED.value
                subscription.response = reason
        await self.session.flush()
        logger.info("whop_access_revoked order_id=%s reason=%s", order.order_id, reason)

    # ─── mini app operations ─────────────────────────────────────────────────

    async def get_latest_order(self, *, tg_user_id: int) -> WhopOrder | None:
        return await self.session.scalar(
            select(WhopOrder)
            .where(WhopOrder.tg_user_id == tg_user_id)
            .order_by(desc(WhopOrder.id))
            .limit(1)
        )

    def _membership_is_valid(self, membership: Mapping[str, Any], now: datetime) -> bool:
        status = str(membership.get("status") or "").lower()
        if status in _VALID_MEMBERSHIP_STATUSES:
            return True
        if status in {"canceled", "cancelled", "expired"}:
            return False
        period_end = _first_datetime(membership, _PERIOD_END_KEYS)
        return period_end is not None and period_end > now

    async def sync_order(self, *, tg_user_id: int) -> WhopOrder | None:
        """Reconcile local state against Whop (used after returning from checkout)."""
        order = await self.get_latest_order(tg_user_id=tg_user_id)
        if order is None or not order.whop_membership_id or not self.configured:
            return order
        try:
            membership = await self._get_client().get_membership(order.whop_membership_id)
        except WhopError as exc:
            logger.warning("whop_sync_failed order_id=%s error=%s", order.order_id, exc)
            return order
        if not isinstance(membership, Mapping):
            return order
        if self._membership_is_valid(membership, _utcnow()):
            await self._grant_access(order, membership)
        else:
            order.status = "cancelled"
            await self._revoke_access(order, reason="Subscription is no longer valid")
        await self.session.commit()
        return order

    async def cancel_subscription(self, *, tg_user_id: int) -> WhopOrder:
        order = await self.get_latest_order(tg_user_id=tg_user_id)
        if order is None or not order.whop_membership_id:
            raise WhopError("No Whop subscription found for this account.")
        if order.status not in {"active", "trialing", "past_due"}:
            raise WhopError("This Whop subscription is not active.")

        await self._get_client().cancel_membership(order.whop_membership_id, at_period_end=True)
        order.cancel_at_period_end = True
        order.metadata_json = {
            **(order.metadata_json or {}),
            "cancel_requested_at": _utcnow().isoformat(),
        }
        await self.session.commit()
        logger.info("whop_cancel_requested order_id=%s", order.order_id)
        return order
