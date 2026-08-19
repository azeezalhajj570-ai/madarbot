# Feature Specification: Workspace-Scoped Task Management

**Feature Branch**: `fix/000-hardcoded-group-id-fallback`

**Created**: 2026-08-19

**Status**: Draft

**Input**: Bug report — "User does not have perms to manage tasks for this group" + requirement to support multiple agents per workspace.

## Problem

The miniapp's Automation Tasks and Lead Capture sections hardcode a fallback group ID of `196` when `account.group_id` is falsy:

```typescript
agentsApi.fetchGroupTasks(account.group_id || 196)
```

All agents in the database have `group_id = NULL` (they use the workspace/tenant model), so this always falls back to `196`. Group `196` does not exist in the `groups` table, causing a 403 Forbidden on every task API call.

Additionally, the existing `fetchAgentGroups` endpoint returns scraped groups (`scraped_groups.id`), but the task API endpoints need `groups.id` (the internal groups table PK). There is no endpoint that maps an agent's workspace to groups with their `groups.id`.

## User Scenarios & Testing

### User Story 1 — Workspace Groups Available for Task Management (P1)

As an agent operator with multiple agents in a workspace, when I open the Automation tab, I should see groups from my workspace and be able to select one to manage its tasks.

**Acceptance Scenarios**:

1. **Given** an agent with `group_id = NULL`, **When** the user opens the Automation tab, **Then** the component fetches workspace groups and auto-selects the first one; tasks for that group load successfully.
2. **Given** the workspace has multiple groups, **When** the user selects a different group from the dropdown, **Then** tasks for the newly selected group are loaded.
3. **Given** the workspace has no groups, **When** the user opens the Automation tab, **Then** a message is shown indicating no groups are available.
4. **Given** a group is selected, **When** the user creates/edits/deletes a task, **Then** the operation uses the selected group's `groups.id` and succeeds.
5. **Given** multiple agents in the same workspace, **When** any agent's Automation tab is opened, **Then** the same workspace groups are available.

### User Story 2 — Lead Capture Uses Workspace Groups (P1)

As an agent operator, when I create a lead capture task, the group selector should show workspace groups, not hardcoded IDs.

**Acceptance Scenarios**:

1. **Given** a group is selected in the workspace, **When** the user creates a lead capture task, **Then** the task is created for the selected workspace group.

## Scope

- **In scope**: 
  - Backend: New endpoint `GET /webapp/agents/{agent_id}/workspace-groups` that resolves the agent's workspace and returns groups with `groups.id`
  - Frontend: Group picker in `AutomationTasksSection` and `LeadsAcquisitionSection` using workspace groups
  - Frontend: Add `tenant_id` to Agent type and API response
- **Out of scope**: 
  - Populating `groups.tenant_id` column (can be a separate migration)
  - Workspace switcher UI
  - Multi-group task aggregation

## Design Decisions

1. **Backend endpoint**: New `GET /webapp/agents/{agent_id}/workspace-groups` that resolves: `Agent.tenant_id` → `TenantMembership.user_id` → `admin_roles.group_id` → `groups.*`. Returns `groups.id`, `tg_group_id`, `title`.
2. **Frontend**: Fetch workspace groups on component mount. Auto-select first group. Show dropdown if multiple. Use selected group's `groups.id` for all task API calls.
3. **Agent type**: Add `tenant_id` to the Agent API response and frontend type.
4. **Existing task endpoints unchanged**: The group-scoped endpoints (`/webapp/groups/{group_id}/tasks`) work correctly — they just need a valid `groups.id`.
