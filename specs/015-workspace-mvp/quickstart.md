# Quickstart: Multi-User Workspace MVP

## Implementation Order

### Step 1: Schema Migration
Add `tenant_id` to `agents` (new column). `groups.tenant_id` already exists in the DB (added by `20260504_db_redesign.py`, unmapped) — just add it to the `Group` ORM model, no new column. Add `PlanFeature` + `FeatureUsage` tables to `billing.py`. Create migration script to auto-create a `Tenant` + `TenantMembership` for every existing `User`.

**Files**: Alembic migration + `bot/db/models/agent.py`, `bot/db/models/group.py`, `bot/db/models/billing.py`

### Step 1.5: User Resolution Helper
Add `UserService.get_or_create_user_by_tg_id(tg_user_id) -> User`. Every existing `actor_user_id` in the dashboard API is a raw `tg_user_id` (BigInteger); `TenantMembership`/`Tenant` are keyed on `users.id` (Integer PK). Nothing today resolves one to the other — this step has to land before workspace membership checks can run at all.

**Files**: `bot/services/user_service.py`

### Step 2: Workspace Service
Create `bot/services/workspace_service.py` with methods:
- `get_or_create_user_workspace(user_id)` — auto-create if missing
- `list_members(workspace_id)`
- `invite_member(workspace_id, inviter_user_id, identifier, role)`
- `remove_member(workspace_id, user_id)`
- `change_role(workspace_id, user_id, new_role)`

### Step 3: API Router
Create `bot/dashboard/api/routers/workspace.py` with the 6 endpoints from contracts.

### Step 4: Auth Integration
Modify `dependencies.py` `get_identity` to call `get_or_create_user_by_tg_id(identity.user_id)` (Step 1.5), then resolve and inject `active_workspace_id` via `TenantMembership`. The identity profile (`build_identity_profile`) already returns group data — extend it to include workspace info.

### Step 5: Re-Scope Existing Queries
Update agent and group queries in existing routers to filter by `tenant_id` instead of `linked_by_user_id` / `owner_user_id`. Key locations:
- `agents.py`: `webapp_agents_list`, `webapp_agent_jobs`
- `admin.py`: webapp endpoints
- `owner.py`: owner-scoped endpoints
- `scraper.py`: scraper group queries

### Step 6: Frontend
Minimal additions to `index.html`:
- Workspace name in header
- Invite member modal
- Member list in settings page

### Step 7: Subscription Wiring
Wire `billing.py`'s `Subscription`/`Entitlement` (tenant-scoped) into the subscription check middleware, replacing `SubscriptionService.has_active_subscription(tg_user_id)` with a tenant-scoped check. This is the first thing to actually use `billing.py` in production — write a smoke test that creates a `Subscription` + `Entitlement` end-to-end before relying on it. Also materialize `Entitlement` rows from `PlanFeature` on subscription creation (see data-model.md step 10) so `FeatureUsage` checks have limits to compare against.

**Note**: `feature/015-saas-subscription-architecture` (#164) independently drafted a second, incompatible `plans`/`subscriptions` schema. That branch needs to be updated to point at this same `billing.py` + `PlanFeature` + `FeatureUsage` design before it lands — otherwise its migration will collide with this one on table names. Not this branch's job to fix, but blocks #164 shipping as currently speced.

## Testing

```bash
# Run existing tests to verify no regressions
pytest -x -q

# Manual smoke test:
# 1. Login as User A → workspace auto-created
# 2. User A invites User B
# 3. User B logs in → sees same agents/groups
```

## Rollback

If issues arise:
1. Revert the migration (remove `tenant_id` columns)
2. Restore old query scoping patterns
3. No data loss — `tenant_id` is nullable during migration window
