# Feature Specification: Whop Payments for the Agents Mini App

**Status**: Implemented
**Branch**: `feature/304-whop-payments`
**Issue**: [#304](https://github.com/azeezalhajj570-ai/madarbot/issues/304)

## Goal

Let users subscribe to the agents mini app through Whop — the hosted product at
`whop.com/azeez-tech-83b5/madarbot-telegram-community-management`
($29.99/month with a 7-day free trial) — instead of the legacy Stripe checkout,
which created a checkout session but never granted access.

Decisions taken with the owner before implementation:

- Whop is the payment provider for **both** Pro and Business ($79), so two Whop
  plans are configured (`WHOP_PLAN_ID_PRO`, `WHOP_PLAN_ID_BUSINESS`).
- Checkout opens Whop's **hosted page** in an external browser via
  `Telegram.WebApp.openLink` rather than embedding a third-party checkout
  iframe in the Telegram WebView (3DS/iframe reliability).
- Fulfillment is **webhook-driven** and mirrors the real subscription
  (trial, renewal, cancellation) instead of granting a one-off 30-day block.

## Architecture

```text
Mini app                Whop                    Backend
   │                      │                        │
   │ POST checkout/whop ──┼───────────────────────>│ WhopOrder(status=pending)
   │                      │                        │ + create checkout configuration
   │<──────── { url } ────┼────────────────────────│   metadata={order_id, tg_user_id, plan}
   │                      │                        │
   │ openLink(url) ──────>│  buyer pays (trial)    │
   │                      │                        │
   │                      │ POST /api/webhooks/whop│ verify signature
   │                      │───────────────────────>│ idempotency by webhook-id
   │                      │                        │ grant/extend/revoke
   │                      │                        │   SubscriptionRequest
   │ poll status ─────────┼───────────────────────>│ (bot_kind="agents")
   │<──────── active ─────┼────────────────────────│
```

Access always lands on the legacy `subscription_requests` row for
`(tg_user_id, bot_kind="agents")`, so every existing plan gate keeps working
without changes.

## Components

| Component | Purpose |
|-----------|---------|
| `bot/db/models/whop.py` | `WhopOrder` (a sale, pending → paid) and `WhopWebhookEvent` (delivery ids) |
| `alembic/versions/20260918_001_add_whop_tables.py` | Tables, chained onto head `20260901_001` |
| `bot/services/whop_service.py` | Whop API client, Standard Webhooks signature verification, fulfillment state machine |
| `bot/dashboard/api/routers/whop.py` | Webhook receiver, checkout, sync, cancel |
| `apps/miniapp-agents/src/App.tsx` | `SubscriptionForm` subscribes through Whop and reconciles on return |

## Fulfillment rules

| Whop event | Effect |
|-----------|--------|
| `payment.succeeded` | Order marked paid; access granted/extended to the membership's period end |
| `membership.activated` / `went_valid` | Access granted (trialing when a future trial end is present) |
| `membership.deactivated` / `went_invalid` | Access revoked (row cancelled) |
| `payment.failed` / `payment.requires_action` | Order marked `past_due`; access is not extended |
| anything else | Ignored |

- The order row is written **before** the buyer sees the checkout form, so the
  checkout's `metadata` can carry our `order_id`; payments and memberships
  created from that checkout inherit it.
- Period end prefers Whop's own field (`valid_until`, `expiration_date`,
  `expires_at`, `current_period_end`, `renewal_period_end`, `renewal_end`,
  `period_end`), falling back to the trial end (while in the future) or
  `now + WHOP_RENEWAL_DAYS`. An authoritative membership read via
  `GET /memberships/{id}` wins over the webhook payload field-by-field, but a
  sparse API response never discards a period field the payload carried.
- Renewals extend the same `subscription_requests` row from
  `max(current_expiry, new_period_end)` — access is never shortened.
- Cancellation is at period end (`POST /memberships/{id}/cancel`): the order is
  flagged `cancel_at_period_end` and access continues until the period ends.

## Webhook security

Whop signs deliveries per the Standard Webhooks spec:

```text
signed content = "{webhook-id}.{webhook-timestamp}.{raw body}"
signature      = base64(HMAC-SHA256(secret, signed content))
header         = webhook-signature: "v1,<signature> [v1,<signature> ...]"
```

- Timestamps outside ±300s are rejected; the signature is compared in constant
  time against every `v1,` value offered.
- The secret is accepted both raw and base64-decoded (Whop documents `ws_…` and
  Standard Webhooks base64-decodes `whsec_…`), so either convention verifies.
- Delivered **at least once**, so `webhook-id` is stored in the same transaction
  as the work it caused: a duplicate is skipped, a failed delivery leaves no row
  and is retried by Whop (the endpoint answers 500, not 200).

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/webhooks/whop` | webhook signature |
| POST | `/webapp/agents/subscription/checkout/whop` (and `/api/agents/…`) | agents boundary |
| POST | `/webapp/agents/subscription/whop/sync` (and `/api/agents/…`) | agents boundary |
| POST | `/webapp/agents/subscription/whop/cancel` (and `/api/agents/…`) | agents boundary |

`GET /webapp/agents/subscription/status` additionally reports `provider`,
`trial_ends_at`, `cancel_at_period_end`, and `order_status`.

## Configuration

| Variable | Purpose |
|----------|---------|
| `WHOP_ENABLED` | Master switch for the mini app checkout (webhook stays reachable) |
| `WHOP_API_KEY` | Whop API key (`apik_…`) |
| `WHOP_WEBHOOK_SECRET` | Webhook signing secret (`ws_…`) |
| `WHOP_COMPANY_ID` | Account the checkout belongs to (`biz_…`) |
| `WHOP_PLAN_ID_PRO` / `WHOP_PLAN_ID_BUSINESS` | Plan ids being sold |
| `WHOP_API_BASE_URL` | `https://sandbox-api.whop.com/api/v1` for sandbox testing |
| `WHOP_CHECKOUT_BASE_URL` | Hosted checkout origin (default `https://whop.com`) |
| `WHOP_TRIAL_DAYS` / `WHOP_RENEWAL_DAYS` | Display/fallback period lengths (7 / 30) |

## Operational notes

- Nginx already proxies every path on `madar.azeez-tech.com` to the backend on
  `127.0.0.1:8009`, so the webhook URL needs no infra change. Note this is the
  active host: `madar.hamedco.com` is not served from this box (`infra/nginx-madarbot.conf`
  still carries blocks for it, but the running config does not).
- Register the webhook in the Whop dashboard pointing at
  `https://madar.azeez-tech.com/api/webhooks/whop` and subscribe to
  `payment.succeeded`, `payment.failed`, `payment.requires_action`,
  `membership.activated`, and `membership.deactivated`.
- Memberships bought directly on the Whop product page (outside the mini app)
  cannot be attributed to a Telegram user, because no `order_id` is on them.
- The Stripe endpoint and its client function remain in place and unused by the
  mini app UI.

## Testing

`tests/test_whop_service.py` covers signature verification (valid, raw-secret
encoding, tampered body, wrong secret, stale timestamp, missing headers),
timestamp parsing, checkout metadata, grant on payment, trial activation,
delivery idempotency, renewal extension, revocation, `past_due`, sync both ways,
and cancellation-at-period-end.
