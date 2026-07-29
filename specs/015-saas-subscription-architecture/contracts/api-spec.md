# API Specification — SaaS MVP

**Base URL**: `https://madar.hamedco.com/api/v1`

**Auth**: `Authorization: Bearer <token>` or Telegram WebApp init data.

## Subscription

### `GET /subscription`

Current user's subscription with plan details.

```json
{
    "id": "sub_abc123",
    "plan": {"name": "Pro", "price": 2900, "billing": "monthly"},
    "status": "active",
    "started_at": "2026-06-01",
    "expires_at": "2026-07-31",
    "period": "2026-07"
}
```

### `POST /subscription/change`

Change to a different plan.

```json
// Request
{"plan_id": "p_pro"}

// Response
{"status": "active", "plan": "Pro", "previous_plan": "Free"}
```

## Plans

### `GET /plans`

List all active plans with their features.

```json
{
    "plans": [
        {
            "id": "p_free",
            "name": "Free",
            "price": 0,
            "billing": "monthly",
            "features": [
                {"key": "chat", "name": "AI Chat", "enabled": true, "limit": 500},
                {"key": "ocr", "name": "OCR", "enabled": false}
            ]
        },
        {
            "id": "p_pro",
            "name": "Pro",
            "price": 2900,
            "billing": "monthly",
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

## Features

### `GET /features`

All features with entitlement for the current user.

```json
{
    "features": [
        {"key": "chat", "name": "AI Chat", "enabled": true,
         "limit": 10000, "used": 385, "remaining": 9615},
        {"key": "ocr", "name": "OCR", "enabled": true,
         "limit": 500, "used": 12, "remaining": 488},
        {"key": "voice", "name": "Voice", "enabled": false}
    ]
}
```

## Usage

### `GET /usage`

Current usage with remaining quota per feature + resource counts.

```json
{
    "plan": "Pro",
    "period": "2026-07",
    "features": [
        {"key": "chat", "name": "AI Chat", "enabled": true,
         "limit": 10000, "used": 385, "remaining": 9615},
        {"key": "ocr", "name": "OCR", "enabled": true,
         "limit": 500, "used": 12, "remaining": 488},
        {"key": "api", "name": "API", "enabled": true,
         "limit": 100000, "used": 2500, "remaining": 97500},
        {"key": "voice", "name": "Voice", "enabled": false}
    ],
    "resources": {
        "agents": {"active": 2, "limit": 10},
        "knowledge_bases": {"active": 1, "limit": 5}
    }
}
```

### `POST /usage/check`

Check quota and record usage atomically. Returns current state after increment.

```json
// Request
{"feature_key": "chat", "quantity": 1, "source": "web"}

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

### `GET /resources`

```json
{
    "resources": [
        {"id": "res_abc", "type": "agent", "name": "Support Bot",
         "status": "active", "created_at": "2026-06-15T10:00:00Z"},
        {"id": "res_def", "type": "knowledge_base", "name": "Product Docs",
         "status": "active", "created_at": "2026-07-01T08:00:00Z"}
    ],
    "summary": {"agents": {"active": 2, "limit": 10}, "knowledge_bases": {"active": 1, "limit": 5}}
}
```

### `POST /resources`

```json
// Request
{"type": "agent", "name": "Sales Bot", "metadata": {"model": "gpt-4"}}

// Response 201
{"id": "res_xyz", "type": "agent", "name": "Sales Bot", "status": "active",
 "created_at": "2026-07-29T12:00:00Z"}
```

### `DELETE /resources/{id}`

Soft delete (sets status to `deleted`).

```json
// Response 200
{"status": "deleted"}
```

## Dashboard

### `GET /dashboard`

Composite view combining subscription + usage + resources for the dashboard UI.

```json
{
    "plan": {"name": "Pro", "status": "active", "renewal": "2026-07-31"},
    "features": [
        {"key": "chat", "label": "Chat", "used": 385, "limit": 10000},
        {"key": "ocr", "label": "OCR", "used": 12, "limit": 500}
    ],
    "resources": {
        "agents": 2,
        "knowledge_bases": 1
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

Error codes: `feature_not_enabled`, `limit_exceeded`, `plan_not_found`, `subscription_expired`.
