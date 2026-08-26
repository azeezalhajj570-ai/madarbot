# Bulk Add by Non-Admin Group Members

**Feature Branch**: `feature/020-bulk-add-by-non-admin`

**Status**: Implemented

**Reference**: `specs/014-bulk-add-members/spec.md`

## Overview

Allow a Telegram agent to perform bulk member additions to a group when the
agent is a member of that group, without requiring the agent to be an admin or
creator. Telegram remains the final authority over whether the individual add
operation is permitted.

## Problem

`GET /webapp/agents/{id}/groups` computed `can_add_members` as:

```python
can_add_members = tg_group_id in agent_member_group_ids or row.last_agent_id == agent.id
```

The spec for this feature (`specs/014-bulk-add-members/spec.md` FR-001) said the
field should be true only when the agent is admin/creator in `scraped_members`,
and the frontends filtered the bulk-add target dropdown by `can_add_members`.
A non-admin member therefore saw an empty (or misleading) target list, even
though Telegram itself may permit the add.

Additionally, `last_agent_id` (a scraped-data ownership marker) was used as a
permission substitute — an agent who merely scraped a group it is not a member
of was offered as a bulk-add target.

## Solution

Eligibility is now based purely on the agent's actual membership in the group:

```python
is_member      = tg_group_id in agent_member_group_ids
is_admin       = tg_group_id in admin_group_ids          # role in {admin, creator}
can_add_members = is_member
```

- `is_member` / `is_admin` are exposed independently.
- `can_add_members` = `is_member`. Admin/creator status does not gate it.
- `last_agent_id` is no longer used as a permission substitute.
- Telegram RPCs (`channels.InviteToChannelRequest`, `messages.AddChatUserRequest`)
  remain the final authority; `CHAT_ADMIN_REQUIRED` is mapped to `ERROR_NOT_ADMIN`
  and recorded as a per-member failure without invalidating the group or its
  scraped members.

## Files Changed

- `bot/agents/account_group_membership_service.py` — `list_managed_member_groups`
  returns `is_member`, `is_admin`, and `can_add_members = is_member`.
- `bot/db/models/scraper.py` — `search_vector` uses
  `TSVECTOR().with_variant(Text(), "sqlite")` so the SQLite test schema can be
  created (previously the SQLite tests errored on this column).
- `packages/miniapp-shared/src/types/index.ts` — `AgentManagedGroup` gains
  `is_member` / `is_admin`; `can_add_members` kept as a deprecated alias.
- `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` — target
  dropdown includes any group where the agent is a member.
- `dashboard/src/pages/admin/BulkAddPage.tsx` — target autocomplete uses
  `is_member` (with `can_add_members` alias fallback).
- `bot/dashboard/frontend/index.html` — legacy dashboard target filter uses
  `is_member` (with alias fallback).
- `tests/test_agent_service.py` — eligibility tests (normal member, admin,
  last-scraper-only, non-member).
- `tests/test_bulk_add_invitations.py` — Telegram `NOT_ADMIN` permission-failure
  tests (record failure, continue batch, no group/scraped-member deletion).

## API Contract

`GET /webapp/agents/{id}/groups` returns per group:

```json
{
  "tg_group_id": 123456789,
  "is_member": true,
  "is_admin": false,
  "can_add_members": true
}
```

- Normal member: `is_member=true`, `is_admin=false`, `can_add_members=true`.
- Admin: `is_member=true`, `is_admin=true`, `can_add_members=true`.
- Not a member: `is_member=false`, `can_add_members=false`.
- `is_admin` never controls `can_add_members`.
