# Data Model: Multi-User Workspace MVP

## Existing Models (Reused)

### Tenant (`bot/db/models/tenant.py`)
```
Tenant
├── id: int (PK)
├── owner_user_id: FK → users.id (NOT NULL)
├── name: str(255)
├── slug: str(128) (unique, nullable)
├── is_active: bool (default: true)
├── business_profile: JSON (default: {})
└── settings_json: JSON (default: {})
```

### TenantMembership (`bot/db/models/tenant.py`)
```
TenantMembership
├── id: int (PK)
├── tenant_id: FK → tenants.id (ON DELETE CASCADE)
├── user_id: FK → users.id (ON DELETE CASCADE)
├── role: str(32) — "owner" | "admin" | "member" | "viewer"
├── is_active: bool (default: true)
└── UNIQUE(tenant_id, user_id)
```

### Subscription (`bot/db/models/billing.py`)
```
Subscription
├── id: int (PK)
├── tenant_id: FK → tenants.id (ON DELETE CASCADE)
├── plan_id: FK → plans.id (nullable)
├── status: str(32) — "pending" | "active" | "past_due" | "cancelled" | "expired"
├── current_period_start: datetime
├── current_period_end: datetime
├── cancelled_at: datetime (nullable)
├── metadata_json: JSON
├── UNIQUE active per tenant (partial index WHERE status = 'active')
```

### Entitlement (`bot/db/models/billing.py`)
```
Entitlement
├── id: int (PK)
├── subscription_id: FK → subscriptions.id (ON DELETE CASCADE)
├── key: str(128) — e.g. "max_agents", "max_groups", "max_members"
└── value: str(512) — stored as string, parsed to int/bool
```

## Modified Models

### Agent (`bot/db/models/agent.py`) — ADD `tenant_id`
```
Agent (existing columns unchanged, +1 new)
├── ...
├── tenant_id: FK → tenants.id (nullable, NOT NULL after migration)
└── INDEX(tenant_id) for scoped queries
```

### Group (`bot/db/models/group.py`) — ADD `tenant_id`
```
Group (existing columns unchanged, +1 new)
├── ...
├── tenant_id: FK → tenants.id (nullable, NOT NULL after migration)
├── owner_user_id: FK → users.id (kept for backward compat)
└── INDEX(tenant_id) for scoped queries
```

## State Transitions

### Workspace Lifecycle
```
User signs up → Tenant auto-created → Owner invites members
                                           ↓
                              Member accepts → Can see/manage all agents & groups
                                           ↓
                              Owner removes member → Member loses access
                                           ↓
                              Owner cancels subscription → Workspace frozen (read-only)
```

### Member Roles
| Role | Can view | Can manage agents | Can invite | Can manage billing |
|------|----------|------------------|------------|-------------------|
| owner | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ❌ |
| member | ✅ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |

## Migration Plan

1. Add `tenant_id` columns to `agents` and `groups` (nullable)
2. Create `Tenant` row for every `User` (name = `full_name ?? "My Workspace"`)
3. Create `TenantMembership(role="owner")` for each user → their tenant
4. Backfill `Agent.tenant_id` via `Agent.linked_by_user_id → User → TenantMembership → tenant_id`
5. Backfill `Group.tenant_id` via `Group.owner_user_id → User → TenantMembership → tenant_id`
6. Make `tenant_id` NOT NULL after backfill
7. Drop the `AGENTS_WORKSPACE_TG_GROUP_BASE` hidden-group hack
