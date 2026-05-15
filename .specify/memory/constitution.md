<!--
  Sync Impact Report
  ==================
  Version change: 1.0.0 → 1.1.0
  Modified principles:
    - II. Test-First Quality → II. Code Quality (NON-NEGOTIABLE) (new content)
    - (old II replaced by III. Testing Standards (NON-NEGOTIABLE), materially expanded)
  Added sections:
    - IV. User Experience Consistency (new principle)
    - V. Performance Requirements (new principle)
  Removed sections: none
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ (no change needed — generic Constitution Check)
    - .specify/templates/spec-template.md ✅ (no change needed)
    - .specify/templates/tasks-template.md ✅ (no change needed)
    - .specify/templates/checklist-template.md ✅ (no change needed)
  Follow-up TODOs:
    - TODO(RATIFICATION_DATE): ask project founder for original adoption date
-->

# MadarBot Constitution

## Core Principles

### I. Security & Secrets Management (NON-NEGOTIABLE)

- Never commit `.env`, bot tokens, API keys, Telegram session files,
  database credentials, private keys, or production logs containing secrets
- Use `.env.example` for safe placeholder values only
- All secrets MUST be injected via environment variables or Docker secrets,
  never hardcoded in source code
- Credential leaks are P0 incidents requiring immediate rotation of all
  affected tokens and keys
- MCP tokens MUST be scoped to a `tg_user_id`
- Dashboard authentication via Telegram WebApp or `DASHBOARD_BROWSER_USERS`

### II. Code Quality (NON-NEGOTIABLE)

- Static analysis (ruff lint, ruff format, mypy) MUST pass with zero errors
  before any merge to main
- No dead code, commented-out code, debug print statements, or temporary
  artifacts MAY be present in committed code
- All public function signatures, method signatures, and module-level
  declarations MUST have complete type annotations
- Functions MUST adhere to the single responsibility principle — do one
  thing and do it well
- Complexity MUST be justified with documented rationale; prefer simple,
  readable code over clever or overly abstract solutions
- AI-generated code MUST be reviewed with the same rigor, test coverage,
  and quality standards as human-written code
- Linting and formatting MUST be enforced in CI (GitHub Actions tests.yml)
- Every merge MUST leave the codebase cleaner than it was found (scout rule)

### III. Testing Standards (NON-NEGOTIABLE)

- Tests MUST pass before any commit or merge to main
- New features or bug fixes MUST include tests at the appropriate level of
  the testing pyramid
- Testing pyramid hierarchy: unit tests (fastest, most numerous) >
  integration tests > contract tests > end-to-end / smoke tests
- Use `pytest` as the testing framework with pytest-asyncio for async tests
- Tests MUST be independent (no shared state), idempotent (repeatable),
  and hermetic (no external dependencies beyond controlled fixtures)
- Database schema changes (Alembic migrations) MUST be verified with tests
- Test coverage MUST be measured and reported; critical business paths
  require >= 90% coverage
- Flaky tests MUST be investigated immediately and either fixed or
  quarantined — never tolerated or ignored
- Test-driven development (red-green-refactor) is strongly encouraged for
  complex logic, data transformations, and state machines

### IV. User Experience Consistency

- All user-facing interfaces (dashboard SPA, admin panels, miniapp) MUST
  follow consistent visual patterns: typography, spacing, color palette,
  and component behavior
- UI text and labels MUST respect the configured `DEFAULT_LANGUAGE` setting
- Error messages presented to users MUST be human-readable, actionable, and
  never expose raw stack traces, internal paths, or implementation details
- Every UI component MUST handle all states: loading, empty, populated,
  error, and edge cases (e.g., truncation, overflow)
- Form inputs MUST provide inline validation with real-time feedback
- All pages MUST render correctly at target breakpoints (desktop, tablet,
  mobile) without horizontal overflow or broken layouts
- User-facing failures MUST be surfaced via structured events for
  monitoring and alerting

### V. Performance Requirements

- API endpoints MUST respond within 500 ms at p95 for standard synchronous
  operations (reads, simple writes)
- Background jobs (lead capture, group sync, message processing) MUST
  complete within their configured timeouts; overdue jobs MUST trigger
  alerts
- Database queries MUST use appropriate indexes; N+1 query patterns across
  async ORM relationships are FORBIDDEN in production code paths
- All network-bound and disk-bound operations MUST use async I/O
  (asyncio, asyncpg, async SQLAlchemy)
- Frontend pages (dashboard, miniapp) MUST reach interactive state within
  2 seconds on target network connections
- Resource-heavy operations (bulk Telegram scrapes, data exports) MUST be
  offloaded to Dramatiq background workers, never executed in request
  handlers
- Frequently accessed, infrequently changing data (group lists, task
  configurations) SHOULD be cached via Redis with appropriate TTL
- Container resource limits (memory, CPU) MUST be defined per service in
  `docker-compose.yml` and monitored via health checks

### VI. Async-First & Event-Driven Architecture

- I/O-bound operations MUST use `asyncio`
- Database access MUST use asyncpg / async SQLAlchemy
- Background jobs MUST use Dramatiq
- Blocking calls in async context are FORBIDDEN
- Event-driven patterns are preferred for cross-service communication
- Every service endpoint MUST expose a health check

### VII. Containerized Infrastructure

- All services MUST run in Docker containers
- Docker Compose manages multi-service orchestration
- Immutable infrastructure: rebuild images, do not patch running containers
- Service configurations defined in `docker-compose.yml` with
  environment-specific overlays (`.dev.yml`, `.deploy.yml`)
- Dependencies (PostgreSQL, Redis) defined as Compose services

### VIII. Structured Observability

- ALL operations MUST log structured events with consistent naming
- Session state changes MUST be tracked (`agent_session_state_changed`)
- Listener lifecycle MUST be logged (`agent_listener_started`,
  `agent_listener_message_seen`)
- Task outcomes MUST be recorded
  (`agent_message_received_for_task`, `agent_job_succeeded`)
- Leads MUST be deduplicable by `group_id`, `tg_user_id`,
  and `source_group_tg_id`
- Health check endpoints required for every service

## Technology Stack & Constraints

- **Language**: Python 3.11+
- **API Framework**: FastAPI
- **Primary Database**: PostgreSQL 16
- **Cache / Queue**: Redis 7
- **Deployment**: Docker + Docker Compose
- **Config Management**: Pydantic `BaseSettings`
- **ORM**: SQLAlchemy (async) + Alembic migrations
- **Testing**: pytest + pytest-asyncio
- **Frontend**: FastAPI Jinja2 dashboard + React SPA (`miniapp-agents`)
- **Bot**: python-telegram-bot / Telethon for agent sessions
- **Code Quality**: ruff (lint + format), mypy (type checking)
- **CI**: GitHub Actions (tests.yml) — lint, format check, tests, build

## Development Workflow & Quality Gates

- Branch from `main` with short-lived branches
- Branch naming: `fix/`, `feat/`, `docs/`, `test/`, `chore/` prefixes
- Commit format: `<type>: <short description>`
  (e.g., `fix: persist lead capture records`)
- Before committing: review diff, remove debug code, confirm no secrets,
  run relevant tests, update docs for behavior changes
- PRs require review and passing CI before merge
- Definition of Done:
  - Code implemented
  - Tests pass
  - Docs updated
  - Migrations verified (if applicable)
  - Deployment impact understood
  - Rollback path clear
  - PR reviewed and merged safely

## Governance

- This Constitution supersedes all other practices and documentation
- Amendments require: documented proposal, team review and approval, and
  a migration plan for affected systems
- Versioning follows Semantic Versioning (MAJOR.MINOR.PATCH):
  - MAJOR: backward-incompatible principle changes or removals
  - MINOR: new principles or materially expanded guidance
  - PATCH: clarifications, wording refinements, typo fixes
- All PRs and reviews MUST verify constitution compliance
- Complexity MUST be justified with documented rationale
- The `AGENTS.md` file serves as the runtime development guidance file

**Version**: 1.1.0 | **Ratified**: TODO(RATIFICATION_DATE) | **Last Amended**: 2026-05-14
