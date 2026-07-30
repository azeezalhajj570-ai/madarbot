# Feature Specification: Multi-User Workspace MVP

**Feature Branch**: `015-workspace-mvp`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "multi user account in workspace so user can manage them together per subscription"

## User Scenarios & Testing

### User Story 1 - Workspace Owner Invites a Team Member (Priority: P1)

A user with an active subscription can invite another Telegram user to their workspace, granting them access to manage the same agents and groups.

**Why this priority**: This is the core of the feature — multiple users sharing management of the same resources.

**Independent Test**: Can be fully tested by creating a workspace, inviting a second user, and verifying they can see the same agents and groups.

**Acceptance Scenarios**:

1. **Given** User A has an active subscription, **When** User A invites User B via Telegram username, **Then** User B receives a notification and can access the workspace
2. **Given** User B has been invited to a workspace, **When** User B views the dashboard, **Then** they see the same agents and groups as User A
3. **Given** User A has no active subscription, **When** User A tries to invite User B, **Then** the request is rejected with a subscription-required error

---

### User Story 2 - Sub-Scoped Agents and Groups (Priority: P1)

Agents and groups are scoped to the workspace, not the individual user, so all workspace members share them.

**Why this priority**: Without this, multiple users can't manage the same resources.

**Independent Test**: Can be tested by creating an agent under a workspace and verifying it's visible to all workspace members.

**Acceptance Scenarios**:

1. **Given** a workspace with 2 members, **When** User A links a new Telegram agent, **Then** User B can see and manage that agent
2. **Given** a workspace with 2 members, **When** User A syncs a group, **Then** User B can see that group in their dashboard

---

### User Story 3 - Subscription Scoped to Workspace (Priority: P2)

The subscription is owned by the workspace, not the individual user. All workspace members share the same plan limits.

**Why this priority**: Enables the business model where one subscription covers a team.

**Independent Test**: Can be tested by having a workspace on a free plan, then upgrading and verifying all members benefit.

**Acceptance Scenarios**:

1. **Given** a workspace with 2 members and an active Pro subscription, **When** either member checks subscription status, **Then** both see "Pro"
2. **Given** a workspace exceeds plan limits (e.g., 6 groups on a 5-group plan), **When** a member tries to add a group, **Then** the request is rejected

---

### Edge Cases

- What happens when a user belongs to multiple workspaces?
- What happens to agents/groups when the workspace subscription is cancelled?
- What happens when the last active member leaves a workspace?

## Requirements

### Functional Requirements

- **FR-001**: System MUST allow a user to create a workspace and become its owner
- **FR-002**: Workspace owners MUST be able to invite other Telegram users as members
- **FR-003**: Workspace members MUST share visibility of all agents and groups in that workspace
- **FR-004**: Subscription MUST be scoped to the workspace, not the individual user
- **FR-005**: The existing `Tenant` model MUST be reused as the workspace entity
- **FR-006**: Existing agents and groups MUST be migratable to workspace-scoping
- **FR-007**: The hidden single-user workspace (AGENTS_WORKSPACE_TG_GROUP_BASE) MUST be replaced by the `Tenant` model

### Key Entities

- **Tenant (Workspace)**: The organizational unit that owns agents, groups, and a subscription
- **TenantMembership**: Links a User to a Tenant with a role (owner/admin/member)
- **Subscription**: Scoped to Tenant instead of individual tg_user_id

## Success Criteria

### Measurable Outcomes

- **SC-001**: Two users in the same workspace can see identical agent and group lists within 1 minute of invitation
- **SC-002**: Subscription status is consistent across all workspace members
- **SC-003**: Backward compatible — existing single-user setups continue to work after migration

## Assumptions

- Existing `Tenant` and `TenantMembership` models will be reused (already in `bot/db/models/`)
- The new billing system (`Subscription` in `bot/db/models/billing.py`) will be wired up instead of the old `SubscriptionRequest` system
- Migration of existing users: each existing user gets an auto-created single-member workspace
