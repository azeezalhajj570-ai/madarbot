# Implementation Plan

## Architecture Investigation Complete

See `research.md` for full investigation findings.

**Summary:** The existing architecture supports atomic claims with minimal changes. Workspace isolation is already built into the API layer via `WorkspaceContext`. The `AgentJob` model is designed for async execution and should not be extended for claim management. A dedicated `MemberClaim` table is the cleanest approach.

---

## Phase 1 — Database Model (MemberClaim)

Create `bot/db/models/member_claim.py` with the `MemberClaim` model.

**Fields:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | Auto-increment |
| `tenant_id` | FK → tenants.id | Workspace isolation |
| `scraped_group_id` | FK → scraped_groups.id | Source group |
| `scraped_member_id` | FK → scraped_members.id | Member being claimed |
| `agent_id` | FK → agents.id | Claiming agent |
| `agent_job_id` | FK → agent_jobs.id | Optional: links to bulk operation |
| `status` | str | active / completed / released / expired / failed |
| `claimed_at` | datetime | When claim was created |
| `expires_at` | datetime | Lease expiration |
| `released_at` | datetime | When claim was released |

**Unique constraint:** Partial index on `(tenant_id, scraped_group_id, scraped_member_id)` WHERE `status = 'active'` — prevents multiple active claims for the same member in the same workspace.

**Alembic migration:** Add to `alembic/versions/` with the unique index.

---

## Phase 2 — Claim Service

Create `bot/services/member_claim_service.py` with:

| Method | Purpose |
|--------|---------|
| `claim_members(tenant_id, agent_id, scraped_group_id, member_ids, ttl_minutes)` | Atomic bulk claim. Returns `{claimed: [...], conflicts: [...]}`. |
| `release_claims(tenant_id, agent_id, claim_ids)` | Release specific claims. |
| `release_operation_claims(tenant_id, agent_id, agent_job_id)` | Release all claims for an operation. |
| `expire_stale_claims()` | Background task to expire old claims. |
| `get_active_claims(tenant_id, scraped_group_id)` | List active claims for a group (returns agent info). |
| `validate_claim_ownership(tenant_id, agent_id, claim_id)` | Verify claim belongs to agent. |

**Atomic claim strategy:** Use `INSERT ... ON CONFLICT DO NOTHING` with the partial unique index. This is atomic at the database level — no `SELECT FOR UPDATE` needed. The insert returns the affected rows; any member that conflicts (active claim exists) is reported as a conflict.

---

## Phase 3 — Claim API Endpoints

Add to `bot/dashboard/api/routers/agents.py` (or a new `claims.py` router):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agents/{id}/claims` | POST | Create claims for selected members |
| `/agents/{id}/claims` | GET | List active claims for a source group |
| `/agents/{id}/claims/{claim_id}` | DELETE | Release a specific claim |
| `/agents/{id}/claims/release-operation` | POST | Release all claims for an agent_job_id |

**Request model for POST /claims:**
```python
class ClaimMembersRequest(BaseModel):
    source_tg_group_id: int
    member_ids: list[int]  # ScrapedMember.id values
    agent_job_id: int | None = None
    ttl_minutes: int = 30  # default claim duration
```

**Response model:**
```python
class ClaimMembersResponse(BaseModel):
    claimed: list[int]  # successfully claimed member IDs
    conflicts: list[ClaimConflict]  # members already claimed by another agent
```

---

## Phase 4 — Integrate Into Bulk-Add Flow

Modify `POST /agents/{id}/member-adds` in `bot/dashboard/api/routers/agents.py:828`:

**Current flow:**
```
Frontend sends user_ids → Create AgentJob → Dispatch
```

**New flow:**
```
Frontend sends user_ids → Create claims → Create AgentJob (with claim_ids) → Dispatch
```

**Changes:**
1. Before creating the `AgentJob`, call `MemberClaimService.claim_members()`.
2. If any conflicts, return them to the frontend (partial success).
3. Store `claim_ids` in `AgentJob.job_payload` so the worker can release them on completion.
4. In `BulkAddMembersRuntime.execute()`, after job completion/failure, release claims.

**Also modify `BulkAddMembersRuntime.execute()`** (`bot/agents/runtime.py:1086`):
- At the end of execution (success or failure), call `MemberClaimService.release_operation_claims()` to release all claims for this job.

---

## Phase 5 — Modify Member Search API

Modify `GET /agents/{id}/member-search` in `bot/dashboard/api/routers/agents.py:495`:

**Current behavior:** Returns `ScrapedMember` rows with basic info.

**New behavior:** Include claim status for each member:

```python
class AgentGroupMember(BaseModel):
    # ... existing fields ...
    claim_status: str | None = None  # "available" | "claimed_by_you" | "claimed_by_other"
    claim_agent_name: str | None = None  # name of agent holding the claim (if permitted)
```

**Query modification:** LEFT JOIN with `member_claims` WHERE `status = 'active'` to get claim status.

---

## Phase 6 — Frontend Changes

Modify `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx`:

**Member display states:**
- Available: checkbox enabled, normal styling
- Claimed by you: checkbox enabled, "Selected by you" badge
- Claimed by other: checkbox disabled, "Held by {agent_name}" badge, reduced opacity

**Claim refresh:**
- Before submitting bulk-add, refresh claim state to catch conflicts.
- On conflict response, update member list and show conflict notification.

**Shared API client** (`packages/miniapp-shared/src/api/agents.ts`):
- Add `createClaims()`, `getClaims()`, `releaseClaims()` methods.

---

## Phase 7 — Stale Claim Expiration

**Strategy:** Lazy expiration + periodic cleanup.

1. **Lazy expiration:** When reading claims, check `expires_at`. If expired, treat as released.
2. **Periodic cleanup:** Add a Dramatiq periodic task (or use existing scheduler) to delete expired claims every 5 minutes.
3. **Default TTL:** 30 minutes (configurable per claim).

**Implementation:** Add `expire_stale_claims()` to `MemberClaimService` and schedule it in the worker.

---

## Phase 8 — Testing

| Test | Type | Priority |
|------|------|----------|
| Single agent claims members | Unit | P1 |
| Two agents claim different members | Integration | P1 |
| Two agents claim same member (conflict) | Integration | P1 |
| Partial conflict in bulk claim | Integration | P1 |
| Claim expiration | Unit | P1 |
| Release on job completion | Integration | P1 |
| Release on job failure | Integration | P1 |
| Workspace isolation | Integration | P1 |
| Concurrent bulk claims | Stress | P2 |
| Large bulk selection (1000+ members) | Performance | P2 |

---

## Phase 9 — Documentation

Update:
- `AGENTS.md` — Add claim lifecycle documentation
- `specs/019-workspace-member-claiming/spec.md` — Mark as implemented
- API documentation (if any)
- Frontend component documentation
