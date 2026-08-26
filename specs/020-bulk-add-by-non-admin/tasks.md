# Implementation Tasks

## Backend ✅

- [x] `list_managed_member_groups()`: add `is_member`, `is_admin`; set
  `can_add_members = is_member`.
- [x] Remove `last_agent_id` from the `can_add_members` condition (FR-003).
- [x] `search_vector` uses `TSVECTOR().with_variant(Text(), "sqlite")` so the
  SQLite test schema can be created.

## Shared Types ✅

- [x] `AgentManagedGroup`: add `is_member`, `is_admin`; keep `can_add_members`
  as a deprecated alias.

## Frontend ✅

- [x] Miniapp `AutomationTasksSection.tsx`: include groups where the agent is a
  member in the bulk-add target dropdown.
- [x] Dashboard `BulkAddPage.tsx`: target autocomplete uses `is_member`.
- [x] Legacy dashboard `index.html`: target filter uses `is_member`.

## Tests ✅

- [x] Normal member `is_member=true`, `is_admin=false`, `can_add_members=true`
  and appears in the target selector.
- [x] Admin `is_member=true`, `is_admin=true`, `can_add_members=true`.
- [x] Last scraper alone (`is_member=false`) does not grant `can_add_members`.
- [x] Non-member group is not eligible.
- [x] Telegram `NOT_ADMIN` permission failure is recorded per member without
  deleting/invalidating the group or its scraped members.
- [x] Batch continues after a `NOT_ADMIN` failure.

## Verification ✅

- [x] Run affected test files (Redis reachable).
- [x] Confirm remaining suite failures are pre-existing on `main`.
- [x] Typecheck `apps/miniapp-agents`, `packages/miniapp-shared`, `dashboard` —
  no new errors in changed files.
