# MVP Implementation Quickstart

## 1. Migration

```bash
alembic revision --autogenerate -m "add_billing_tables"
alembic upgrade head
```

## 2. Seed Plans + Features

```bash
python -m scripts.seed_billing_data
```

This creates: Free, Pro, Business, Enterprise plans with 9 features and per-plan limits.

## 3. Core Service

```python
# bot/billing/service.py

def can_use_feature(user, feature_key: str) -> bool:
    sub = get_subscription(user)
    if not sub or sub.status not in ('active', 'trial'):
        return False

    pf = get_plan_feature(sub.plan_id, feature_key)
    if not pf or not pf.enabled:
        return False

    if pf.limit_value is None:
        return True  # unlimited

    usage = get_usage(user, feature_key)
    return usage.used_count < pf.limit_value
```

## 4. Wire in Middleware

```python
# FastAPI dependency
def require_feature(feature_key: str):
    def _check(user=Depends(get_current_user)):
        if not can_use_feature(user, feature_key):
            raise HTTPException(403, "Feature not available on your plan")
    return _check

# Usage in routes
@router.post("/chat")
async def chat(..., _=Depends(require_feature("chat"))):
    record_usage(user, "chat", source="web")
```

## 5. Dashboard Route

```python
@router.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    sub = get_subscription(user)
    quota = get_quota(user)
    resources = count_resources(user)
    return templates.TemplateResponse("dashboard.html", {
        "subscription": sub,
        "quota": quota,
        "resources": resources,
    })
```

## 6. Verify

```bash
# Check plans
curl /api/v1/plans

# Get usage
curl /api/v1/usage

# Check + record usage atomically
curl -X POST /api/v1/usage/check \
  -d '{"feature_key": "chat", "quantity": 1, "source": "web"}'
```
