# Architecture Investigation — Workspace Member Claiming

## 1. Workspace Agents/Users Representation

**Existing models (no changes needed):**

| Entity | Table | File | Notes |
|--------|-------|------|-------|
| `Tenant` | `tenants` | `bot/db/models/messaging.py:12` | Workspace entity. `workspace_id` = `tenant_id`. |
| `User` | `users` | `bot/db/models/user.py:14` | Human identity with `tg_user_id`. |
| `TenantMembership` | `tenant_memberships` | `bot/db/models/tenant.py:24` | Many-to-many: Users ↔ Workspaces with roles. |
| `Agent` | `agents` | `bot/db/models/agent.py:67` | Linked Telegram account. `tenant_id` FK → workspace. |
| `WorkspaceContext` | — | `bot/dashboard/api/dependencies.py:264` | API dependency that resolves workspace from request. |

**Key finding:** Workspace isolation is already built into the API layer. Every agent endpoint receives a `WorkspaceContext` with `tenant_id`. Claims can use this directly.

---

## 2. Source-Group Members Representation

**Existing models (no changes needed):**

| Entity | Table | File | Notes |
|--------|-------|------|-------|
| `ScrapedGroup` | `scraped_groups` | `bot/db/models/scraper.py:16` | Source group metadata. |
| `ScrapedMember` | `scraped_members` | `bot/db/models/scraper.py:82` | Members of scraped groups. Unique on `(tg_group_id, tg_user_id)`. |

**Key finding:** `ScrapedMember` has `id` (PK), `scraped_group_id` (FK), `tg_group_id`, `tg_user_id`. The uniqueness constraint on `(tg_group_id, tg_user_id)` means each member appears once per group. Claims should reference `scraped_members.id` or `(tg_group_id, tg_user_id)`.

---

## 3. Current Bulk-Add Operation Flow

**End-to-end flow:**

```
Frontend (AutomationTasksSection.tsx)
  │
  ├─ GET /agents/{id}/member-search  → returns ScrapedMember rows
  ├─ GET /agents/{id}/target-group-members/{tgGroupId}  → existing target members (de-dup)
  │
  └─ POST /agents/{id}/member-adds  → BulkMemberAddRequest
       │                               { target_tg_group_id, user_ids: list[int], ... }
       │
       ├─ normalize_member_add_payload()
       ├─ AgentJobService.create_job(job_type="member_add")
       ├─ dispatch_agent_job() → Dramatiq queue
       │
       └─ Worker: BulkAddMembersRuntime.execute()
            ├─ Pre-fetch access_hash from ScrapedMember.raw_data
            ├─ Pre-fetch MemberOperation for dedup
            ├─ For each user_id: rate limit → add_user_to_group() → audit log
            └─ Return results
```

**Key files:**

| Step | File | Line |
|------|------|------|
| Member search API | `bot/dashboard/api/routers/agents.py` | 495-532 |
| Target members API | `bot/dashboard/api/routers/agents.py` | 535-555 |
| Bulk-add API | `bot/dashboard/api/routers/agents.py` | 828-878 |
| Request model | `bot/dashboard/api/routers/_shared.py` | 102-107 |
| Payload normalization | `bot/agents/jobs.py` | 163-212 |
| Job creation | `bot/agents/agent_job_service.py` | 74-166 |
| Dispatch | `bot/agents/dispatch.py` | 168-196 |
| Worker execution | `bot/agents/worker.py` | 542-818 |
| Bulk add runtime | `bot/agents/runtime.py` | 1086-1477 |
| Frontend selection | `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` | 131-489 |
| API client | `packages/miniapp-shared/src/api/agents.ts` | 131-142, 447-457 |

---

## 4. Existing Operation/Job Model

**`AgentJob`** (`bot/db/models/agent.py:125-147`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | Unique job identifier |
| `agent_id` | FK → agents.id | Owner agent |
| `campaign_id` | FK → campaigns.id | Optional campaign link |
| `job_type` | str | `"member_add"` for bulk-add |
| `job_payload` | JSON | Contains `user_ids`, `target_tg_group_id`, etc. |
| `status` | str | pending → queued → running → completed/failed/aborted |
| `scheduled_at` | datetime | For delayed execution |

**`MemberOperation`** (`bot/db/models/member_operation.py:22-68`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `tg_group_id` | int | Target group |
| `tg_user_id` | int | Target user |
| `agent_id` | FK → agents.id | Performing agent |
| `operation_type` | str | `"invite_link"` |
| `status` | str | pending/sent/joined/failed/expired |

**Key finding:** `AgentJob` is the closest existing entity to an "operation" that could own claims. However, it's designed for async execution, not for synchronous claim management. A dedicated `MemberClaim` table is cleaner and avoids coupling claim lifecycle to job lifecycle.

---

## 5. Existing Locking/Reservation Mechanisms

| Mechanism | File | Purpose | Reusable? |
|-----------|------|---------|-----------|
| Redis SET NX | `bot/agents/listener.py:870` | Inter-contact cooldown | No (rate limiting only) |
| asyncio.Lock | `bot/agents/session.py:30` | Telegram client session lock | No (session-level) |
| SELECT FOR UPDATE skip_locked | `bot/services/campaign_service.py:379` | Campaign row locking | **Yes** — pattern is reusable |
| SELECT FOR UPDATE | `bot/services/workspace_service.py:407` | Workspace row locking | **Yes** — pattern is reusable |

**Key finding:** PostgreSQL `SELECT FOR UPDATE` with `skip_locked=True` is already used in the codebase. This pattern can be reused for atomic claim acquisition. The unique constraint approach is simpler and more appropriate for member claims.

---

## 6. Where Should `MemberClaim` Live?

**Recommended location:** New file `bot/db/models/member_claim.py`

**Reasoning:**
- `bot/db/models/scraper.py` is already large (ScrapedGroup, ScrapedMember, ScrapedMessage, etc.)
- `bot/db/models/agent.py` focuses on agent identity and jobs
- A separate file keeps the claim model clean and maintainable

**FK targets:**
- `tenant_id` → `tenants.id` (workspace isolation)
- `scraped_group_id` → `scraped_groups.id` (source group)
- `scraped_member_id` → `scraped_members.id` (member)
- `agent_id` → `agents.id` (claiming agent)
- `agent_job_id` → `agent_jobs.id` (optional, links to the bulk operation)

**Unique constraint:** `(tenant_id, scraped_group_id, scraped_member_id)` WHERE `status = 'active'` — prevents multiple active claims for the same member in the same workspace.

---

## 7. APIs That Handle Member Selection

| Endpoint | File:Line | Purpose | Needs Claim Integration? |
|----------|-----------|---------|--------------------------|
| `GET /agents/{id}/member-search` | `agents.py:495` | Search members for selection | **Yes** — must return claim status |
| `GET /agents/{id}/target-group-members/{tgGroupId}` | `agents.py:535` | De-dup against target group | No |
| `POST /agents/{id}/member-adds` | `agents.py:828` | Submit bulk add job | **Yes** — must create claims before dispatch |
| `POST /agents/{id}/jobs/bulk-preflight` | `agents.py:780` | Exclusion check | **Yes** — must check claim conflicts |

**New endpoints needed:**
- `POST /agents/{id}/claims` — create claims for selected members
- `DELETE /agents/{id}/claims` — release claims
- `GET /agents/{id}/claims?source_tg_group_id=X` — list active claims for a group

---

## 8. Frontend Components

| Component | File | Purpose | Changes Needed |
|-----------|------|---------|----------------|
| `AutomationTasksSection.tsx` | `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` | Bulk add member selection | Add claim status display, disable held members |
| `CampaignsPage.tsx` | `apps/miniapp-agents/src/pages/CampaignsPage.tsx` | Campaign member selection | Add claim status display (if bulk-add is used here) |
| API client | `packages/miniapp-shared/src/api/agents.ts` | API calls | Add claim API methods |

---

## 9. Database & Transaction Mechanisms

| Aspect | Current State |
|--------|---------------|
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 with asyncpg |
| Migrations | Alembic |
| Unique constraints | Already used (`scraped_members` unique on `(tg_group_id, tg_user_id)`) |
| Row locking | `SELECT FOR UPDATE skip_locked=True` used in campaign service |
| Transaction isolation | PostgreSQL default (READ COMMITTED) |

**Key finding:** PostgreSQL supports partial unique indexes (`CREATE UNIQUE INDEX ... WHERE status = 'active'`) which can enforce the one-active-claim-per-member invariant without locking the entire table.

---

## 10. Can Existing Architecture Support Atomic Claims?

**YES — with minimal changes.**

**What already works:**
- Workspace isolation via `WorkspaceContext.tenant_id`
- `ScrapedMember` model with unique `(tg_group_id, tg_user_id)`
- `AgentJob` model for tracking bulk operations
- PostgreSQL unique constraints and `SELECT FOR UPDATE`
- API dependency injection for authentication/authorization

**What needs to be built:**
1. `MemberClaim` model (new table)
2. Claim API endpoints (new routes)
3. Integration into `POST /agents/{id}/member-adds` (modify existing endpoint)
4. Claim status in `GET /agents/{id}/member-search` (modify existing endpoint)
5. Frontend claim display (modify `AutomationTasksSection.tsx`)
6. Stale claim cleanup (background task or lazy expiration)

**What does NOT need to change:**
- `AgentJob` model (claims are separate from job execution)
- `BulkAddMembersRuntime` (processes members as before, just needs valid claims)
- `ScrapedMember` / `ScrapedGroup` models
- Workspace/authentication system
- Telegram integration layer

**Architecture decision:** The cleanest approach is to add claims as a **pre-flight step** before job dispatch:

```
Select members → Create claims → Dispatch job → Process → Release claims
```

This keeps the existing `AgentJob` + `BulkAddMembersRuntime` flow intact while adding workspace-level concurrency safety.
