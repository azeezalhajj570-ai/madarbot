# API Specification — SaaS MVP

> **Revised 2026-07-30**: paths updated to this repo's actual convention
> (`/api/...` + `/webapp/...` dual registration — there is no `/api/v1`
> prefix anywhere else in the codebase) and responses updated to be
> workspace-scoped (`tenant_id`, via `WorkspaceContext` from
> `015-workspace-mvp`) instead of per-user. IDs are the existing Integer
> PKs from `billing.py`, not new UUIDs. See `research.md` and
> `data-model.md` for the full rationale.

**Auth**: `Authorization: Bearer <token>` or Telegram WebApp init data
(existing `extract_dashboard_identity` flow) + `X-Workspace-Id` header to
select among multiple workspace memberships (defaults to the caller's
owned workspace — see `015-workspace-mvp`'s `get_workspace_context`).

## Subscription

### `GET /api/subscription`

Active workspace's subscription with plan details.

```json
{
    "id": 42,
    "plan": {"slug": "business", "name": "Business", "price_monthly_cents": 7900},
    "status": "active",
    "current_period_start": "2026-06-01",
    "current_period_end": "2026-07-31",
    "period": "2026-07"
}
```

### `POST /api/subscription/change`

Change the active workspace's plan.

```json
// Request
{"plan_slug": "business"}

// Response
{"status": "active", "plan": "business", "previous_plan": "starter"}
```

## Plans

### `GET /api/plans`

List all active plans with their features.

```json
{
    "plans": [
        {
            "slug": "starter",
            "name": "Starter",
            "price_monthly_cents": 2900,
            "features": [
                {"key": "chat", "name": "AI Chat", "enabled": true, "limit": 500},
                {"key": "ocr", "name": "OCR", "enabled": false}
            ]
        },
        {
            "slug": "business",
            "name": "Business",
            "price_monthly_cents": 7900,
            "highlight": true,
            "features": [
                {"key": "chat", "name": "AI Chat", "enabled": true, "limit": 10000},
                {"key": "ocr", "name": "OCR", "enabled": true, "limit": 500},
                {"key": "voice", "name": "Voice", "enabled": true, "limit": 500}
            ]
        }
    ]
}
```

`name` per feature is resolved from a small static Python lookup
(`feature_key → display name`), not a database join — see research.md's
note on skipping a normalized `Feature` catalog table for MVP.

## Usage

### `GET /api/usage`

Current usage with remaining quota per feature + resource counts, for
the caller's active workspace.

```json
{
    "plan": "business",
    "period": "2026-07",
    "features": [
        {"key": "chat", "name": "AI Chat", "enabled": true,
         "limit": 10000, "used": 385, "remaining": 9615},
        {"key": "ocr", "name": "OCR", "enabled": true,
         "limit": 500, "used": 12, "remaining": 488},
        {"key": "voice", "name": "Voice", "enabled": false}
    ],
    "resources": {
        "agents": {"active": 2, "limit": 3},
        "groups": {"active": 14, "limit": 50}
    }
}
```

### `POST /api/usage/check`

Check quota and record usage atomically, against the active workspace's
subscription. Returns current state after increment.

```json
// Request
{"feature_key": "chat", "quantity": 1}

// Response 200
{"feature": "chat", "used": 386, "limit": 10000, "remaining": 9614}

// Response 429 (limit exceeded)
{
    "error": {
        "code": "limit_exceeded",
        "message": "Monthly chat limit of 10,000 reached",
        "feature": "chat",
        "limit": 10000,
        "used": 10000,
        "reset_period": "2026-08"
    }
}
```

## Resources

No `/api/resources` CRUD endpoint — resource counts are read directly
from the existing `Agent`/`Group` (and future typed) tables, not a
separate ledger. Resource creation already happens through the existing
`/api/agents`, group-linking, etc. endpoints; this feature only adds the
*count-against-limit* check via `require_feature`/`can_use_feature`
(see quickstart.md), it doesn't introduce a new way to create resources.

Resource summary is folded into `GET /api/usage`'s `resources` field
above rather than a separate endpoint.

## Dashboard

### `GET /api/usage/dashboard`

Composite view combining subscription + usage + resources for the
dashboard UI — same payload shape as `GET /api/usage`, kept as a distinct
path in case the dashboard eventually needs a heavier aggregate (recent
activity, upgrade prompts) than the raw usage check.

```json
{
    "plan": {"name": "Business", "status": "active", "renews": "2026-07-31"},
    "features": [
        {"key": "chat", "name": "Chat", "used": 385, "limit": 10000},
        {"key": "ocr", "name": "OCR", "used": 12, "limit": 500}
    ],
    "resources": {
        "agents": 2,
        "groups": 14
    }
}
```

## Error Format

```json
{
    "error": {
        "code": "limit_exceeded",
        "message": "Monthly chat limit of 10,000 reached",
        "details": {
            "feature": "chat",
            "limit": 10000,
            "used": 10000,
            "reset_period": "2026-08"
        }
    }
}
```

Error codes: `feature_not_enabled`, `limit_exceeded`, `plan_not_found`,
`subscription_expired`.
