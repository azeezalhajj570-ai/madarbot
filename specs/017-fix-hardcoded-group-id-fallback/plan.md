# Implementation Plan: Fix Hardcoded Group ID Fallback

**Branch**: `fix/000-hardcoded-group-id-fallback`
**Spec**: `specs/017-fix-hardcoded-group-id-fallback/spec.md`

## Overview

Replace the hardcoded `|| 196` fallback with proper group resolution from the agent's managed groups. No backend changes needed — the existing group-scoped task endpoints work fine once given a valid `group_id`.

## Task 1: Add `useAgentGroup` hook

Create `apps/miniapp-agents/src/hooks/useAgentGroup.ts` — a small hook that:
- Takes `agentId: number | undefined`
- Calls `agentsApi.fetchAgentGroups(agentId)` on mount
- Returns `{ groups, selectedGroup, setSelectedGroup, loading }`
- Auto-selects the first group when groups load

## Task 2: Refactor `AutomationTasksSection.tsx`

- Import and use `useAgentGroup(account.id)`
- Replace all `account.group_id || 196` with `selectedGroup?.id`
- Add a group selector (dropdown) at the top when multiple groups exist
- Guard task loading/actions to only run when `selectedGroup?.id` is available
- Show a "no groups" message when groups list is empty

**Lines to change**:
- Line 136: `fetchGroupTasks(account.group_id || 196)` → `fetchGroupTasks(selectedGroup!.id)`
- Line 262: `updateGroupTask(account.group_id || 196, ...)` → `updateGroupTask(selectedGroup!.id, ...)`
- Line 265: `createGroupTask(account.group_id || 196, ...)` → `createGroupTask(selectedGroup!.id, ...)`
- Line 281: `deleteGroupTask(account.group_id, ...)` → `deleteGroupTask(selectedGroup!.id, ...)`

## Task 3: Refactor `LeadsAcquisitionSection.tsx`

- Import and use `useAgentGroup(account.id)`
- Replace `account.group_id || 196` on line 139 with `selectedGroup?.id`
- Guard the lead capture submit to require a selected group

**Line to change**:
- Line 139: `createGroupTask(account.group_id || 196, {...})` → `createGroupTask(selectedGroup!.id, {...})`

## Task 4: Verify

- Run TypeScript typecheck on both `apps/miniapp-agents` and `packages/miniapp-shared`
- Rebuild Docker images: `docker compose build miniapp_agents`
