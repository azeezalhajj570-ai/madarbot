# Implementation Plan: Bulk Add by Non-Admin Group Members

**Branch**: `feature/020-bulk-add-by-non-admin`
**Spec**: `specs/020-bulk-add-by-non-admin/spec.md`

## Task 1: Backend eligibility

`bot/agents/account_group_membership_service.py` — in
`list_managed_member_groups()`, compute `is_member` from
`agent_member_group_ids` and `is_admin` from `admin_group_ids`, then set
`can_add_members = is_member`. Drop the `last_agent_id` term.

## Task 2: SQLite test schema fix

`bot/db/models/scraper.py` — `search_vector` column:
`TSVECTOR().with_variant(Text(), "sqlite")`. Unblocks the SQLite-based tests
that were erroring on the TSVECTOR column.

## Task 3: Shared types

`packages/miniapp-shared/src/types/index.ts` — add `is_member` and `is_admin`
to `AgentManagedGroup`; keep `can_add_members` as a deprecated alias.

## Task 4: Frontends

- `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` — target
  group dropdown includes any group where `is_member !== false` (alias fallback).
- `dashboard/src/pages/admin/BulkAddPage.tsx` — same for the target autocomplete.
- `bot/dashboard/frontend/index.html` — same for the legacy dashboard filter.

## Task 5: Tests

- `tests/test_agent_service.py` — normal member, admin, last-scraper-only,
  non-member eligibility.
- `tests/test_bulk_add_invitations.py` — `NOT_ADMIN` permission failure is
  recorded per member, the batch continues, and no group/scraped-member
  deletion occurs.

## Task 6: Verify

- Run affected test files in a container with Redis reachable.
- Typecheck `apps/miniapp-agents`, `packages/miniapp-shared`, `dashboard`.
