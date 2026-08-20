# Implementation Tasks

## Architecture Investigation ✅

- [x] Inspect current workspace/agent architecture.
- [x] Inspect existing group/member models.
- [x] Inspect existing bulk-add operation flow.
- [x] Inspect existing operation/job/locking mechanisms.
- [x] Identify reusable existing components.
- [x] Document final integration points.
- [x] Write research.md with findings.

## Database Model

- [ ] Create `bot/db/models/member_claim.py` with `MemberClaim` model.
- [ ] Add Alembic migration for `member_claims` table.
- [ ] Add partial unique index: `(tenant_id, scraped_group_id, scraped_member_id)` WHERE `status = 'active'`.
- [ ] Register model in `bot/db/models/__init__.py`.

## Claim Service

- [ ] Create `bot/services/member_claim_service.py`.
- [ ] Implement `claim_members()` — atomic bulk claim via `INSERT ON CONFLICT DO NOTHING`.
- [ ] Implement `release_claims()` — release specific claims by ID.
- [ ] Implement `release_operation_claims()` — release all claims for an agent_job_id.
- [ ] Implement `expire_stale_claims()` — delete/expire claims past `expires_at`.
- [ ] Implement `get_active_claims()` — list active claims for a source group.
- [ ] Implement `validate_claim_ownership()` — verify claim belongs to agent.

## Claim API

- [ ] Add `POST /agents/{id}/claims` endpoint.
- [ ] Add `GET /agents/{id}/claims` endpoint (list active claims for a group).
- [ ] Add `DELETE /agents/{id}/claims/{claim_id}` endpoint.
- [ ] Add `POST /agents/{id}/claims/release-operation` endpoint.
- [ ] Add request/response models in `bot/dashboard/api/routers/_shared.py`.

## Bulk-Add Integration

- [ ] Modify `POST /agents/{id}/member-adds` to create claims before job dispatch.
- [ ] Store `claim_ids` in `AgentJob.job_payload`.
- [ ] Modify `BulkAddMembersRuntime.execute()` to release claims on completion/failure.
- [ ] Handle partial conflicts in bulk-add response.

## Member Search Integration

- [ ] Modify `GET /agents/{id}/member-search` to include claim status.
- [ ] LEFT JOIN with `member_claims` for active claims.
- [ ] Add `claim_status` and `claim_agent_name` to response model.

## Stale Claim Expiration

- [ ] Add periodic cleanup task for expired claims.
- [ ] Implement lazy expiration in claim read operations.
- [ ] Configure default TTL (30 minutes).

## Frontend

- [ ] Update `AutomationTasksSection.tsx` to display claim status.
- [ ] Disable checkboxes for members held by another agent.
- [ ] Add "Held by {agent_name}" badge for other-agent claims.
- [ ] Add "Selected by you" badge for own claims.
- [ ] Refresh claim state before bulk submission.
- [ ] Handle partial conflict response from backend.
- [ ] Add claim API methods to `packages/miniapp-shared/src/api/agents.ts`.

## Concurrency Tests

- [ ] Test simultaneous claims for the same member.
- [ ] Test concurrent claims for different members.
- [ ] Test partial overlap between two bulk operations.
- [ ] Verify database race-condition protection.
- [ ] Verify workspace isolation.

## Recovery Tests

- [ ] Test cancelled operations release claims.
- [ ] Test failed operations release claims.
- [ ] Test claim expiration after TTL.
- [ ] Test lazy expiration during reads.

## Security Tests

- [ ] Verify workspace authorization on claim endpoints.
- [ ] Prevent cross-workspace claim access.
- [ ] Prevent users releasing claims they do not own.
- [ ] Prevent overwriting another agent's claim.

## Documentation

- [ ] Document claim lifecycle in `AGENTS.md`.
- [ ] Document API changes.
- [ ] Update `specs/019-workspace-member-claiming/spec.md` status.
