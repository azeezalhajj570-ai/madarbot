"""Whop payment endpoints for the agents mini app.

Public surface:
  POST /api/webhooks/whop                      — Whop webhook receiver (signature-authenticated)
  POST /webapp/agents/subscription/checkout/whop — start a checkout, returns the hosted URL
  POST /webapp/agents/subscription/whop/sync     — reconcile against Whop after returning
  POST /webapp/agents/subscription/whop/cancel   — cancel at period end via the Whop API
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.session import get_session
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity
from bot.services.whop_service import WhopError, WhopService, verify_webhook_signature

from ..dependencies import WorkspaceContext, get_identity, get_workspace_context
from .auth_boundary import require_agents_boundary

logger = logging.getLogger(__name__)

router = APIRouter(tags=["whop"])

WEBHOOK_PATH = "/api/webhooks/whop"


class WhopCheckoutRequest(BaseModel):
    plan: Literal["pro", "business"]


def _agents_return_url() -> str | None:
    """Where Whop sends the buyer after checkout.

    Whop rejects anything that is not absolute https, so never forward a
    local/dev URL (the deployed .env still carries a localhost value for
    AGENTS_WEBAPP_URL) — fall through to the first https candidate instead.
    """
    settings = get_settings()
    for candidate in (settings.agents_webapp_url, settings.webapp_url, settings.dashboard_url):
        value = (candidate or "").strip()
        if value.startswith("https://"):
            return value
    return None


def _order_payload(order: Any) -> dict[str, Any]:
    return {
        "order_id": order.order_id,
        "plan": order.plan,
        "status": order.status,
        "current_period_end": order.current_period_end.isoformat()
        if order.current_period_end
        else None,
        "trial_end": order.trial_end.isoformat() if order.trial_end else None,
        "cancel_at_period_end": bool(order.cancel_at_period_end),
    }


@router.post(WEBHOOK_PATH, include_in_schema=False)
async def whop_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    settings = get_settings()
    # Fulfillment is deliberately independent of WHOP_ENABLED: pausing new sales
    # must not stop renewals and cancellations from being honoured, and Whop
    # disables endpoints whose deliveries keep failing.
    if not settings.whop_webhook_secret:
        logger.warning("whop_webhook_received_without_secret")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Whop webhooks are not configured.",
        )

    raw_body = await request.body()
    try:
        verify_webhook_signature(
            raw_body=raw_body,
            headers=request.headers,
            secret=settings.whop_webhook_secret,
        )
    except WhopError as exc:
        logger.warning("whop_webhook_signature_rejected error=%s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature."
        ) from exc

    try:
        event = json.loads(raw_body or b"{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload."
        ) from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload.")

    webhook_id = request.headers.get("webhook-id")
    if not webhook_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing webhook-id.")

    try:
        outcome = await WhopService(session).handle_webhook(event=event, webhook_id=webhook_id)
    except WhopError as exc:
        # Let Whop retry: the delivery row is only written on success.
        logger.error("whop_webhook_failed webhook_id=%s error=%s", webhook_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook processing failed."
        ) from exc

    return {"status": "ok", "outcome": outcome}


@router.post(
    "/api/agents/subscription/checkout/whop", dependencies=[Depends(require_agents_boundary)]
)
@router.post(
    "/webapp/agents/subscription/checkout/whop", dependencies=[Depends(require_agents_boundary)]
)
async def whop_checkout(
    payload: WhopCheckoutRequest,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.whop_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Whop is not configured. Set WHOP_ENABLED and WHOP_API_KEY.",
        )

    try:
        order, url = await WhopService(session).create_checkout(
            tg_user_id=ctx.identity.user_id,
            plan=payload.plan,
            tenant_id=ctx.tenant_id,
            redirect_url=_agents_return_url() or None,
        )
    except WhopError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return {"url": url, "order_id": order.order_id, "plan": order.plan}


@router.post("/api/agents/subscription/whop/sync", dependencies=[Depends(require_agents_boundary)])
@router.post(
    "/webapp/agents/subscription/whop/sync", dependencies=[Depends(require_agents_boundary)]
)
async def whop_sync(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    service = WhopService(session)
    order = await service.sync_order(tg_user_id=identity.user_id)
    if order is None:
        return {"status": "none", "order": None}
    return {"status": order.status, "order": _order_payload(order)}


@router.post(
    "/api/agents/subscription/whop/cancel", dependencies=[Depends(require_agents_boundary)]
)
@router.post(
    "/webapp/agents/subscription/whop/cancel", dependencies=[Depends(require_agents_boundary)]
)
async def whop_cancel(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        order = await WhopService(session).cancel_subscription(tg_user_id=identity.user_id)
    except WhopError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "status": "ok",
        "message": "Subscription will end at the close of the current billing period.",
        "order": _order_payload(order),
    }


__all__ = ["router"]
