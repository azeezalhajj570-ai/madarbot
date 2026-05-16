# Feature Specification: CRM-Style Campaigns for Broadcast Messaging

**Feature Branch**: `001-crm-campaigns`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User requirement for campaign-level broadcast management with cross-group deduplication

## User Scenarios & Testing

### User Story 1 — Create and Manage Campaigns (Priority: P1)

As an agent admin, I want to create broadcast campaigns in draft status with a name, message template, and target group selection, so that I can prepare and organize my outgoing messages.

**Why this priority**: Campaign creation is the foundation — all other features depend on having a campaign entity.

**Independent Test**: Can be fully tested by creating a campaign via the API and verifying the response includes the correct name, status (draft), and message template.

**Acceptance Scenarios**:

1. **Given** I am an authenticated agent admin, **When** I POST to `/campaigns` with `{name, message_template, type, target_filters}`, **Then** a campaign is created with status `draft`.
2. **Given** a draft campaign exists, **When** I PATCH it with updated fields, **Then** the campaign is updated.
3. **Given** a campaign that has not been sent, **When** I DELETE it, **Then** it is removed.

---

### User Story 2 — Send Campaign with Cross-Group Dedup (Priority: P1)

As an agent admin, I want to launch a campaign across multiple groups and have users who belong to multiple groups receive the message only once, so that I avoid annoying recipients with duplicates.

**Why this priority**: This is the core business requirement that motivated the feature.

**Independent Test**: Can be tested by creating two groups with overlapping members, launching a campaign targeting both groups, and verifying each overlapping user receives the message exactly once.

**Acceptance Scenarios**:

1. **Given** a campaign targeting Group A and Group B, **When** User X is in both groups, **Then** User X receives the campaign message only once.
2. **Given** a campaign targeting Group A, **When** User X and User Y are both in Group A, **Then** both receive the message.
3. **Given** User X already received a campaign message, **When** a different campaign targets the same user, **Then** User X receives the second campaign message (different campaigns do not dedup).

---

### User Story 3 — View Campaign Send Logs (Priority: P2)

As an agent admin, I want to view delivery logs filtered by campaign, so that I can see who received, who was skipped, and what failed within a specific campaign.

**Why this priority**: Post-send visibility is essential for campaign accountability and debugging.

**Independent Test**: Can be tested by launching a campaign, then calling the send-logs endpoint and verifying it returns recipient-level records scoped to that campaign.

**Acceptance Scenarios**:

1. **Given** a sent campaign, **When** I GET `/campaigns/{id}/send-logs`, **Then** I see all recipient logs for that campaign.
2. **Given** two campaigns exist, **When** I filter send-logs by campaign_id, **Then** I only see logs for that campaign.
3. **Given** a campaign with skipped users (dedup), **When** I view send-logs, **Then** skipped entries include the reason `duplicate_campaign_recipient`.

---

### Edge Cases

- What happens when a campaign has no target groups selected?
- What happens when all users in a group are excluded (already sent)?
- How does the system handle a campaign being launched while already running?
- What if a campaign's agent is deleted mid-send?

## Requirements

### Functional Requirements

- **FR-001**: System MUST allow creating a campaign with name, type, message template, and target filters.
- **FR-002**: System MUST support campaign statuses: draft, scheduled, running, paused, completed, cancelled.
- **FR-003**: System MUST allow linking multiple AgentJob records to a single Campaign.
- **FR-004**: System MUST prevent duplicate sends to the same user across groups within the same campaign using `campaign_id + tg_user_id + message_hash`.
- **FR-005**: System MUST stamp each SentBroadcastMessage with the campaign_id when sending from a campaign.
- **FR-006**: System MUST track campaign-level counters: total_recipients, sent_count, failed_count, skipped_count.
- **FR-007**: System MUST provide a campaign send-logs endpoint filtered by campaign_id.
- **FR-008**: System MUST preserve existing non-campaign dedup behavior when campaign_id is null.
- **FR-009**: System MUST support listing campaigns with status and aggregate stats.
- **FR-010**: System MUST allow editing draft campaigns (name, template, target filters).
- **FR-011**: System MUST prevent editing a campaign that is running or completed.
- **FR-012**: Database migration MUST be backward compatible (nullable campaign_id FKs).

### Key Entities

- **Campaign**: Groups multiple broadcast jobs under one coordinated send. Tracks aggregate delivery stats and lifecycle status.
- **AgentJob**: Individual broadcast job per target group. Linked to Campaign via campaign_id FK.
- **SentBroadcastMessage**: Per-recipient delivery record. Linked to Campaign via campaign_id FK for cross-group dedup and log filtering.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users in multiple target groups receive a campaign message exactly once.
- **SC-002**: Campaign send-logs return only records belonging to that campaign.
- **SC-003**: Campaign detail endpoint returns accurate aggregate counts.
- **SC-004**: Existing non-campaign broadcasts continue to function with no changes.

## Assumptions

- Agents are pre-configured with access to target groups (scraped members exist).
- Campaign targets groups the agent already has access to.
- Non-campaign broadcasts use existing AgentJob creation flow unchanged.
- The frontend CampaignsPage already exists and will be enhanced to support campaign creation.
