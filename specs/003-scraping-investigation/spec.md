# Feature Specification: Scraping Flow Investigation

**Feature Branch**: `004-scraping-flow-investigation`

**Created**: 2026-06-16

**Status**: Draft

**Input**: User description: "Investigate the current logic for scraping Telegram groups and storing scraped data into the database, then identify optimization opportunities before changing the implementation. The purpose of this issue is to understand the existing scraping pipeline end-to-end and document where performance, reliability, data consistency, and scalability can be improved."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand end-to-end scraping flow (Priority: P1)

As a developer, I need to trace the complete scraping pipeline from the moment a user triggers a scrape in the UI to the moment data is persisted in the database, so that I have a clear mental model of the system's current behavior before making any changes.

**Why this priority**: Without understanding the current flow, any optimization attempt risks breaking existing functionality or introducing regressions.

**Independent Test**: A developer can follow the documented flow and reproduce it by reading the referenced source code files and confirming each step exists in the codebase.

**Acceptance Scenarios**:

1. **Given** the codebase is available, **When** a developer reads the investigation report, **Then** they can identify: which API route creates the scraping job, which `job_type` values are used, which worker/actor executes the logic, and whether scraping is synchronous or split into smaller jobs.
2. **Given** the scraping flow is documented, **When** a new team member reviews it, **Then** they can understand the sequence of events without reading the entire codebase first.

---

### User Story 2 - Document data persistence behavior (Priority: P1)

As a developer, I need to know exactly which database tables, columns, and indexes are involved in storing scraped data, and how writes are performed (single-row vs batch, transactions, upsert logic), so that I can assess data consistency risks and identify write-pattern inefficiencies.

**Why this priority**: Data persistence is the core output of scraping. Understanding write patterns is essential for identifying N+1 query problems and consistency gaps.

**Independent Test**: A developer can query the documented tables and verify their schema matches the investigation findings.

**Acceptance Scenarios**:

1. **Given** the investigation is complete, **When** reviewing the data model documentation, **Then** all tables storing scraped groups, members, messages, and metadata are listed with their key columns.
2. **Given** scraping runs against a group with existing data, **When** duplicate members are encountered, **Then** the duplication handling strategy (upsert/ignore/update) is clearly documented.

---

### User Story 3 - Identify performance bottlenecks (Priority: P2)

As a developer, I need to know the current performance characteristics of the scraping pipeline — how many database queries per scraped member, whether N+1 patterns exist, whether inserts are batched, and whether rate limiting is handled — so that I can prioritize optimization work.

**Why this priority**: Performance issues directly impact the user experience (slow scraping) and operational costs (database load, API rate limit hits).

**Independent Test**: A developer can measure query counts during a scrape and compare them against the documented bottlenecks.

**Acceptance Scenarios**:

1. **Given** a group with 1000 members is scraped, **When** the scraping worker executes, **Then** the number of database round-trips per member is documented and any N+1 patterns are identified.
2. **Given** Telegram enforces rate limits, **When** the scraper encounters a flood wait, **Then** the backoff/retry mechanism is documented.

---

### User Story 4 - Map progress tracking and error handling (Priority: P2)

As a developer, I need to understand how scraping progress is reported to the user, how job status and errors are stored, whether partial results are kept on failure, and whether scraping can resume after interruption, so that I can assess reliability and user experience gaps.

**Why this priority**: Without clear progress and error handling, users are left guessing and partial work may be lost.

**Independent Test**: A developer can trigger a scrape, deliberately cause a failure, and observe whether progress tracking behaves as documented.

**Acceptance Scenarios**:

1. **Given** a scraping job is running, **When** a user checks the dashboard, **Then** they see current progress as documented.
2. **Given** a scraping job fails mid-way, **When** the failure occurs, **Then** the behavior (partial results kept vs rolled back, retry support) matches the documentation.

---

### User Story 5 - Produce prioritized optimization plan (Priority: P3)

As a technical lead, I need a concrete, prioritized list of optimization opportunities derived from the investigation, so that I can plan implementation work in the most impactful order.

**Why this priority**: The investigation's ultimate goal is to guide implementation; the optimization plan is the deliverable that enables follow-up work.

**Independent Test**: A reviewer can read the optimization plan and confirm each recommendation traces back to a finding documented in the investigation.

**Acceptance Scenarios**:

1. **Given** the investigation is complete, **When** reviewing the optimization plan, **Then** each item includes a description of the current state, the proposed improvement, and the expected impact.
2. **Given** implementation resources are limited, **When** prioritizing, **Then** items are ordered by impact (highest first) with dependencies noted.

---

### Edge Cases

- What happens when a Telegram group is deleted or made private during an ongoing scrape?
- How does the system handle groups with tens of thousands of members (memory usage, timeouts)?
- What happens when the database connection is lost mid-scrape?
- How are Telegram API flood waits handled? Is there backoff logic?
- What happens when a scraping job is queued but the agent worker restarts?
- How does the system handle concurrent scraping jobs for the same group?
- What happens when scraped member data contains non-UTF-8 characters or unusual Unicode?
- How are scraped members with no username or phone number represented?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Investigation MUST identify all scraping entry points — UI actions and API endpoints that initiate group/member scraping.
- **FR-002**: Investigation MUST trace the job creation flow, including which `job_type` values are used for scraping, which `agent_jobs` fields are populated, and how jobs are enqueued.
- **FR-003**: Investigation MUST identify the Dramatiq actors or worker functions that execute scraping logic, including their full execution path.
- **FR-004**: Investigation MUST document how Telethon is used within scraping workers to fetch group information, members, and messages.
- **FR-005**: Investigation MUST map all database tables and columns involved in scraped data storage, including models, migrations, indexes, and unique constraints.
- **FR-006**: Investigation MUST document the current write behavior — whether inserts/updates are batched, whether transactions are used, and how duplicates are handled (upsert, ignore, replace).
- **FR-007**: Investigation MUST document how scraping progress is tracked and reported to the user, how job status transitions work, and where errors are stored.
- **FR-008**: Investigation MUST analyze performance characteristics including: query count per scraped entity, N+1 patterns, batch insert presence, index coverage, session/transaction duration, and in-memory data loading.
- **FR-009**: Investigation MUST document Telegram rate limit handling, including flood wait detection, backoff strategy, and retry logic.
- **FR-010**: Investigation MUST produce a prioritized optimization plan with concrete recommendations covering batch inserts, incremental scraping, resume support, progress reporting, retry handling, deduplication, database indexes, job chunking, rate-limit backoff, and memory usage.

### Key Entities

- **Scraping Job**: A unit of work stored in `agent_jobs` with a `job_type`, target groups, status, progress, and error fields. Processed by Dramatiq actors/workers.
- **Scraped Group**: Telegram group metadata stored in `scraped_groups` with title, username, member count, and admin/creator identification.
- **Scraped Member**: Telegram user data stored in `scraped_members` with username, phone, role (admin/creator/member), and group membership relationships.
- **Scraped Message**: Message content stored in `scraped_messages` from monitored groups.
- **Job Status**: Tracking fields for job lifecycle — queued, running, succeeded, failed — with progress indicators and error messages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer unfamiliar with the scraping code can understand the full pipeline by reading the investigation report, without needing to explore the codebase independently.
- **SC-002**: All database tables and models involved in scraping are documented with their key columns and relationships.
- **SC-003**: Every N+1 query pattern and non-batched insert found during the investigation is listed with the affected file and line numbers.
- **SC-004**: The optimization plan contains at least 5 concrete, actionable recommendations, each with a description of current behavior, proposed improvement, and expected impact.
- **SC-005**: The investigation report references specific file paths and function names for all key components, enabling developers to verify findings immediately.

## Assumptions

- The codebase uses Dramatiq for async job processing and Telethon for Telegram API interactions.
- The database is PostgreSQL 16 accessed via SQLAlchemy async sessions.
- The user-facing dashboard and agent mini-app are the primary UI entry points for triggering scrapes.
- The existing `agent_jobs` table is the central job queue and the `scraped_groups`, `scraped_members`, and `scraped_messages` tables are the primary data stores.
- Scraping workers run in the `agent_worker` Docker service.
- No new scraping targets or Telegram API features need to be added — the investigation focuses on the existing pipeline only.
