# Tasks: Repository Audit Process — Comprehensive Codebase Assessment

**Input**: Design documents from `specs/007-repository-audit-process/`

**Prerequisites**: plan.md, spec.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same group
- **[Story]**: Which user story this task belongs to (US1-US19)

---

## Phase 0: Setup & Repository Overview (Shared)

**Purpose**: Gather repository metadata and establish baseline

**Blocks**: All phases need this baseline data

- [ ] T001 Run `git log --oneline --all | wc -l` — count total commits
- [ ] T002 Run `git shortlog -sn --all` — count contributors and their commit counts
- [ ] T003 Run `git log --format="%an" | sort | uniq -c | sort -rn` — author distribution
- [ ] T004 Run `find . -name "*.py" -not -path "*/.git/*" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" | wc -l` — Python file count
- [ ] T005 Run `find . -name "*.py" -not -path "*/.git/*" -not -path "*/__pycache__/*" -not -path "*/node_modules/*" -exec wc -l {} + | tail -1` — total Python lines
- [ ] T006 Run `find . -name "*.tsx" -o -name "*.ts" | grep -v node_modules | grep -v .git | wc -l` — TypeScript file count
- [ ] T007 Read top-level directory listing — identify all major directories (`apps/`, `bot/`, `packages/`, `docs/`, `infra/`, etc.)
- [ ] T008 Read `README.md` — understand project purpose, architecture, and setup
- [ ] T009 Read `pyproject.toml` — identify dependencies, tool config, Python version
- [ ] T010 Read `.gitignore` — verify secrets and build artifacts are excluded
- [ ] T011 Read `.env.example` — inventory all required environment variables

**Checkpoint**: Repository overview section written. Baseline data available for all subsequent phases.

---

## Phase 1: Product Review (US12)

**Purpose**: Understand the product, users, features, and gaps

**Group**: Parallel Group 1 (Structure + Product)

- [ ] T012 [P] [US12] Read `README.md` — extract product description, use cases, target users
- [ ] T013 [P] [US12] Read `CONTRIBUTING.md` and `AGENTS.md` — identify product scope and maturity signals
- [ ] T014 [P] [US12] Read `agents/` directory — review agent behavioral specs for completeness
- [ ] T015 [P] [US12] Read `specs/` directories — inventory all feature specifications and their task completion status
- [ ] T016 [P] [US12] Inventory all major features — check backend (SQLAlchemy models + services), frontend (React components), tests, and spec presence for each
- [ ] T017 [US12] Produce feature completeness matrix and product maturity assessment

**Checkpoint**: Product section written with feature matrix, missing features, and monetization assessment.

---

## Phase 2: Repository Structure Review (US12)

**Purpose**: Assess code organization, find dead code, duplicated logic, and structural issues

**Group**: Parallel Group 1 (Structure + Product)

- [ ] T018 [P] [US12] Search for dead frontend artifacts — pre-built SPAs without source, prototype HTML files, old bundle directories
- [ ] T019 [P] [US12] Search for duplicate CI workflows — multiple `.github/workflows/*.yml` files with overlapping triggers
- [ ] T020 [P] [US12] Search for committed build artifacts — `.pyc` files, `.sqlite3` files, `node_modules/` in repo
- [ ] T021 [P] [US12] Search for unrelated configuration — nginx configs for different domains/products
- [ ] T022 [P] [US12] Search for dual dependency management — both `requirements.txt` and `pyproject.toml` defining dependencies
- [ ] T023 [P] [US12] Identify largest files — run `find . -name "*.py" -exec wc -l {} + | sort -rn | head -10`
- [ ] T024 [US12] Produce repository structure assessment with dead code inventory and recommendations

**Checkpoint**: Repository structure section written with dead code, duplicates, and recommendations.

---

## Phase 3: Architecture Review (US5)

**Purpose**: Assess system architecture, coupling, cohesion, SOLID principles

**Group**: Parallel Group 2 (Code Analysis)

- [ ] T025 [P] [US5] Read `bot/main.py` or equivalent entry point — understand composition root and dependency wiring
- [ ] T026 [P] [US5] Read `bot/config.py` or equivalent — assess Settings class size, field count, and SRP compliance
- [ ] T027 [P] [US5] Read the core runtime directory (`bot/core/`, `bot/core/runtime/`) — evaluate EventBus, PluginManager, Guard-Action-Execute pipeline
- [ ] T028 [P] [US5] Read `bot/services/` — identify import patterns between services to map dependency graph
- [ ] T029 [P] [US5] Read `bot/agents/` and `bot/plugins/` — evaluate plugin isolation, agent-to-plugin dependency direction
- [ ] T030 [P] [US5] Search for FastAPI imports in non-API modules — `grep -r "from fastapi" bot/ --include="*.py" | grep -v "dashboard/api"`
- [ ] T031 [P] [US5] Search for dual schema patterns — legacy + new tables for same domain (billing, audit, agents)
- [ ] T032 [P] [US5] Run `find . -name "*.py" -exec wc -l {} + | sort -rn | head -20` — identify all god-classes (files over 500 lines)
- [ ] T033 [US5] Produce architecture assessment with SOLID score, coupling analysis, and improvement recommendations

**Checkpoint**: Architecture section written with god-class inventory, dependency violations, and SOLID assessment.

---

## Phase 4: Code Quality Review (US6)

**Purpose**: Assess naming, readability, error handling, duplication, deprecated APIs

**Group**: Parallel Group 2 (Code Analysis)

- [ ] T034 [P] [US6] Search for deprecated API usage — `grep -rn "utcnow\|utcfromtimestamp" bot/ --include="*.py"`
- [ ] T035 [P] [US6] Search for bare except blocks — `grep -rn "except Exception:" bot/ --include="*.py"`
- [ ] T036 [P] [US6] Search for inconsistent logging patterns — compare `structlog.get_logger` vs `logging.getLogger` usage across modules
- [ ] T037 [P] [US6] Identify code duplication — manual analysis of similar code blocks across files
- [ ] T038 [P] [US6] Search for inconsistent error handling — `ValueError` vs `PermissionError` vs `HTTPException` for similar scenarios
- [ ] T039 [P] [US6] Read Ruff/Flake8/mypy config in `pyproject.toml` — identify suppressed rules that mask bugs
- [ ] T040 [US6] Produce code quality assessment with duplication map, error handling audit, and consistency findings

**Checkpoint**: Code quality section written with duplication instances, deprecated API calls, and inconsistency analysis.

---

## Phase 5: AI Engineering Review (US9)

**Purpose**: Assess AI provider abstraction, prompt management, evaluation frameworks

**Group**: Parallel Group 2 (Code Analysis)

- [ ] T041 [P] [US9] Read `bot/ai/` — inventory all AI provider classes and their interfaces
- [ ] T042 [P] [US9] Read `bot/plugins/ai_pilot/provider.py` — compare provider hierarchy with `bot/ai/providers.py`
- [ ] T043 [P] [US9] Search for duplicate system prompts — `grep -rn "DEFAULT_SYSTEM_PROMPT\|SYSTEM_PROMPT" bot/ --include="*.py"`
- [ ] T044 [P] [US9] Search for API key in URL patterns — `grep -rn "\?key=" bot/ --include="*.py"`
- [ ] T045 [P] [US9] Read moderation pipeline (`bot/ai/moderation.py`) — evaluate composition quality and fallback strategy
- [ ] T046 [US9] Produce AI engineering assessment with provider abstraction score, duplication analysis, and recommendations

**Checkpoint**: AI engineering section written with provider hierarchy analysis, prompt assessment, and evaluation framework status.

---

## Phase 6: API Review (US8)

**Purpose**: Assess REST design, auth, pagination, validation, consistency

**Group**: Parallel Group 2 (Code Analysis)

- [ ] T047 [P] [US8] Read all router files in `bot/dashboard/api/routers/` — inventory endpoints and their auth dependencies
- [ ] T048 [P] [US8] Search for endpoints without pagination — list endpoints returning query results without `page`/`limit`/`offset` parameters
- [ ] T049 [P] [US8] Search for `dict[str, Any]` endpoint parameters — untyped request bodies that bypass validation
- [ ] T050 [P] [US8] Search for inconsistent response formats — compare response patterns across routers
- [ ] T051 [P] [US8] Read rate limiting middleware — assess per-endpoint vs global rate limiting
- [ ] T052 [P] [US8] Read MCP server (`bot/mcp/`) — assess tool definition quality, auth, and error handling
- [ ] T053 [US8] Produce API assessment with endpoint inventory, auth gaps, pagination gaps, and inconsistency analysis

**Checkpoint**: API section written with endpoint counts, auth gaps, pagination gaps, and format inconsistency analysis.

---

## Phase 7: Database Review (US7)

**Purpose**: Assess schema design, indexes, constraints, migrations, soft deletes

**Group**: Parallel Group 2 (Code Analysis)

- [ ] T054 [P] [US7] Read all model files in `bot/db/models/` — inventory all tables, columns, indexes, constraints
- [ ] T055 [P] [US7] Check for `created_at`/`updated_at` presence — which tables are missing which fields
- [ ] T056 [P] [US7] Check for soft delete columns — search for `deleted_at`, `is_deleted`, `is_active` across all models
- [ ] T057 [P] [US7] Search for missing foreign keys — `BigInteger` columns referencing other tables without `ForeignKey`
- [ ] T058 [P] [US7] Search for missing indexes — columns used in queries without `index=True` or `Index()`
- [ ] T059 [P] [US7] Read Alembic migrations — count migrations, check for pinned revisions (`upgrade <hash>` vs `upgrade head`)
- [ ] T060 [P] [US7] Check for dual schema patterns — legacy + new tables for same domain
- [ ] T061 [US7] Produce database assessment with schema analysis, index gaps, migration health, and recommendations

**Checkpoint**: Database section written with table inventory, index gaps, FK gaps, and migration analysis.

---

## Phase 8: Security Audit (US1)

**Purpose**: Identify all exploitable vulnerabilities

**Group**: Parallel Group 3 (Production Safety)

- [ ] T062 [P] [US1] Search for unauthenticated endpoints — scan every `@router.get/post/put/delete/patch` for auth `Depends`
- [ ] T063 [P] [US1] Search for plaintext secrets in code — `grep -rn "password.*=" bot/ --include="*.py" | grep -v "postgres\|env\|getenv\|os.environ"`
- [ ] T064 [P] [US1] Search for hardcoded credentials in YAML/yml files — `grep -rn "PASSWORD\|password:" docker-compose*.yml --include="*.yml"`
- [ ] T065 [P] [US1] Search for SSRF vectors — user-supplied URLs passed to HTTP clients
- [ ] T066 [P] [US1] Search for SQL injection — user input in `text()`, `execute()`, `ilike()`, `like()` patterns
- [ ] T067 [P] [US1] Search for command injection — `os.system()`, `subprocess.*()` with user input
- [ ] T068 [P] [US1] Search for JWT secret fallback patterns — `or settings.bot_token` in auth functions
- [ ] T069 [P] [US1] Search for encryption bypass — `encrypt_value` returning plaintext silently
- [ ] T070 [P] [US1] Search for API key in URL patterns — `grep -rn "?key=\|api_key=" bot/ --include="*.py"`
- [ ] T071 [P] [US1] Read `bot/mcp/auth.py` — check for auth bypass when token not configured
- [ ] T072 [US1] Produce security audit with severity-classified findings, file:line evidence, and remediation suggestions

**Checkpoint**: Security section written with all findings classified by severity, each with file:line evidence.

---

## Phase 9: CI/CD Audit (US2)

**Purpose**: Assess pipeline maturity and gaps

**Group**: Parallel Group 3 (Production Safety)

- [ ] T073 [P] [US2] Read all `.github/workflows/*.yml` files — inventory workflows, triggers, jobs
- [ ] T074 [P] [US2] Check for security scanning — search for `trivy`, `snyk`, `semgrep`, `bandit`, `grype` in workflows
- [ ] T075 [P] [US2] Check for code coverage — search for `pytest-cov`, `coverage`, `codecov`, `coveralls` in configs
- [ ] T076 [P] [US2] Check for deployment automation — search for deploy scripts, release workflows
- [ ] T077 [P] [US2] Search for branch protection configuration — `.github/CODEOWNERS`, branch protection rules
- [ ] T078 [P] [US2] Check for action pinning — actions referenced by SHA digest vs version tag
- [ ] T079 [US2] Produce CI/CD assessment with pipeline inventory, gaps, and recommendations

**Checkpoint**: CI/CD section written with workflow inventory, security/cov/deploy gaps, and branch protection status.

---

## Phase 10: Docker & Infrastructure Audit (US4)

**Purpose**: Assess Docker setup, nginx config, infrastructure misconfigurations

**Group**: Parallel Group 3 (Production Safety)

- [ ] T080 [P] [US4] Read all Dockerfiles — check for HEALTHCHECK, non-root USER, base image pinning
- [ ] T081 [P] [US4] Read docker-compose files — check for hardcoded credentials, resource limits, logging config, restart policies
- [ ] T082 [P] [US4] Read nginx configs — check for rate limiting, security headers, request body size limits, SSL
- [ ] T083 [P] [US4] Check for `.dockerignore` — verify build context optimization
- [ ] T084 [P] [US4] Check for Docker layer caching — `--mount=type=cache` usage in RUN commands
- [ ] T085 [US4] Produce infrastructure assessment with Docker/nginx findings and recommendations

**Checkpoint**: Infrastructure section written with Docker security, nginx config, and compose file findings.

---

## Phase 11: Performance Analysis (US10)

**Purpose**: Identify bottlenecks, N+1 queries, caching gaps

**Group**: Parallel Group 4 (Operations)

- [ ] T086 [P] [US10] Read `bot/db/session.py` — check connection pool configuration
- [ ] T087 [P] [US10] Search for `asyncio.run()` in worker files — count occurrences
- [ ] T088 [P] [US10] Search for unpaginated list endpoints — endpoints that return all records without limit
- [ ] T089 [P] [US10] Search for N+1 patterns — queries inside loops fetching individual rows
- [ ] T090 [P] [US10] Search for caching — `redis.get/redis.set`, `@cached`, `lru_cache` usage
- [ ] T091 [US10] Produce performance assessment with bottleneck analysis and caching recommendations

**Checkpoint**: Performance section written with connection pool analysis, event loop audit, and pagination gaps.

---

## Phase 12: Observability Audit (US3)

**Purpose**: Assess logging, metrics, tracing, health checks, error reporting

**Group**: Parallel Group 4 (Operations)

- [ ] T092 [P] [US3] Search for structlog vs stdlib logging usage — `grep -rn "structlog.get_logger\|logging.getLogger" bot/ --include="*.py"`
- [ ] T093 [P] [US3] Read metrics definition files — check if Prometheus metrics are defined and exposed via `/metrics`
- [ ] T094 [P] [US3] Read health check endpoints — check if they verify DB/Redis/Telegram connectivity
- [ ] T095 [P] [US3] Search for Sentry/error reporting initialization — which processes have it
- [ ] T096 [P] [US3] Search for distributed tracing — OpenTelemetry, Jaeger, Zipkin imports
- [ ] T097 [US3] Produce observability assessment with logging consistency, metrics exposure, health check depth, and tracing status

**Checkpoint**: Observability section written with logging audit, metrics status, health check depth, and tracing coverage.

---

## Phase 13: Testing Assessment (US11)

**Purpose**: Assess test suite composition, coverage, quality

**Group**: Parallel Group 5 (Quality)

- [ ] T098 [P] [US11] Count test files — `find tests/ -name "test_*.py" | wc -l`
- [ ] T099 [P] [US11] Count test functions — `grep -r "def test_" tests/ --include="*.py" | wc -l`
- [ ] T100 [P] [US11] Count skipped tests — `grep -r "@pytest.mark.skip" tests/ --include="*.py" | wc -l`
- [ ] T101 [P] [US11] Check for coverage tooling — no `pytest-cov`, `.coveragerc`, or `[tool.coverage]` in config
- [ ] T102 [P] [US11] Check for E2E tests — `find tests/ -name "*e2e*" -o -name "*end_to_end*"`
- [ ] T103 [P] [US11] Read `conftest.py` — assess test infrastructure quality (database strategy, mocking, fixtures)
- [ ] T104 [P] [US11] Compare TESTING_STRATEGY.md requirements against actual test suite
- [ ] T105 [US11] Produce testing assessment with coverage gaps, skipped test inventory, and infrastructure quality

**Checkpoint**: Testing section written with test counts, coverage status, skipped test analysis, and gap assessment.

---

## Phase 14: Documentation Review (US13)

**Purpose**: Assess documentation quality, completeness, and consistency

**Group**: Parallel Group 5 (Quality)

- [ ] T106 [P] [US13] Inventory all documentation files — `docs/`, `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.env.example`
- [ ] T107 [P] [US13] Compare `.env.example` variables against `config.py` Settings fields — identify missing and dead variables
- [ ] T108 [P] [US13] Check for cross-document duplication — repeated content across README, AGENTS.md, AGENT.md
- [ ] T109 [P] [US13] Check for port number consistency — compare nginx, docker-compose, and documentation port references
- [ ] T110 [P] [US13] Check for missing document types — ADRs, CHANGELOG, runbooks, architecture diagrams
- [ ] T111 [US13] Produce documentation assessment with quality ratings, inconsistency analysis, and gap inventory

**Checkpoint**: Documentation section written with file inventory, quality ratings, inconsistency map, and gap analysis.

---

## Phase 15: Developer Experience Review (US14)

**Purpose**: Assess local setup, tooling, and development workflow

**Group**: Parallel Group 5 (Quality)

- [ ] T112 [P] [US14] Check for task runner — `Makefile`, `justfile`, `Taskfile.yml`, `taskfile.yml`
- [ ] T113 [P] [US14] Check for pre-commit hooks — `.pre-commit-config.yaml`
- [ ] T114 [P] [US14] Check for devcontainer — `.devcontainer/devcontainer.json`
- [ ] T115 [P] [US14] Check for VS Code settings — `.vscode/settings.json`
- [ ] T116 [P] [US14] Check for local bootstrap script — `scripts/setup.sh`, `scripts/bootstrap.sh`
- [ ] T117 [P] [US14] Read dev compose overlay — `docker-compose.dev.yml` for hot-reload support
- [ ] T118 [US14] Produce developer experience assessment with tooling gaps and recommendations

**Checkpoint**: Developer experience section written with tooling inventory, gaps, and recommendations.

---

## Phase 16: Scalability Assessment (US15)

**Purpose**: Assess horizontal scaling readiness and multi-tenancy

**Group**: Parallel Group 5 (Quality)

- [ ] T119 [P] [US15] Check connection pooling strategy — `NullPool` vs `QueuePool` vs `AsyncAdaptedQueuePool`
- [ ] T120 [P] [US15] Check for shared-nothing architecture — `lru_cache` on settings, module-level singletons
- [ ] T121 [P] [US15] Check multi-tenancy model — which tables have `tenant_id`, which don't
- [ ] T122 [P] [US15] Check for distributed locking — Redis locks, `aioredlock`, or similar
- [ ] T123 [P] [US15] Check for distributed caching — Redis cache layer for database queries
- [ ] T124 [US15] Produce scalability assessment with horizontal scaling readiness and multi-tenancy analysis

**Checkpoint**: Scalability section written with connection pooling, shared-nothing, and multi-tenancy analysis.

---

## Phase 17: Technical Debt Register (US16)

**Purpose**: Consolidate all findings into a prioritized debt register

**Depends on**: Phases 1-16 (all finding data available)

**Sequential**: Must run after all individual phases

- [ ] T125 Collect all findings from Phases 1-16 — extract severity, effort, evidence, and impact
- [ ] T126 Categorize each finding — severity (Critical/High/Medium/Low), effort (XS/S/M/L/XL)
- [ ] T127 Cross-reference findings — link related items across phases
- [ ] T128 Produce consolidated technical debt table with: ID, phase source, severity, effort, evidence, business impact

**Checkpoint**: Technical debt register written with all findings categorized and cross-referenced.

---

## Phase 18: Risk Register (US17)

**Purpose**: Derive operational risks from findings

**Depends on**: Phase 17 (debt register complete)

**Sequential**: Must run after Phase 17

- [ ] T129 For each critical/high severity finding, assess likelihood and business impact
- [ ] T130 Produce risk register table with: ID, description, likelihood, impact, mitigation, phase source
- [ ] T131 Cross-reference risks to specific debt items for traceability

**Checkpoint**: Risk register written with likelihood, impact, and mitigation for each risk.

---

## Phase 19: Scorecard & Roadmap (US18, US19)

**Purpose**: Quantify readiness and produce action plan

**Depends on**: Phases 17-18 (debt and risk data available)

**Sequential**: Must run after Phases 17-18

- [ ] T132 Score each of 13+ dimensions (Product, Architecture, Code Quality, Security, Performance, Testing, Documentation, CI/CD, DevOps, Scalability, Observability, DX, AI Engineering) from 1-10 based on phase findings
- [ ] T133 Calculate overall score as average of all dimension scores
- [ ] T134 Organize critical/urgent findings into Immediate (Week 1) time horizon
- [ ] T135 Organize high-severity findings into Short Term (Month 1) time horizon
- [ ] T136 Organize architectural improvements into Medium Term (Quarter) time horizon
- [ ] T137 Organize strategic investments into Long Term (6-12 Months) time horizon
- [ ] T138 Compile final verdict — is the repository ready for production? Why or why not?
- [ ] T139 Write complete audit report to `docs/audits/AUDIT_REPORT_<timestamp>.md`

**Checkpoint**: Complete audit report written with scorecard, roadmap, and final verdict.

---

## Phase Dependencies

- **Phase 0** (Setup): No dependencies — runs first
- **Phases 1-16**: All depend on Phase 0 (baseline data). Can run in parallel within their groups.
  - Group 1 (Structure + Product): Phases 1-2 — no cross-dependencies
  - Group 2 (Code Analysis): Phases 3-7 — no cross-dependencies
  - Group 3 (Production Safety): Phases 8-10 — no cross-dependencies
  - Group 4 (Operations): Phases 11-12 — no cross-dependencies
  - Group 5 (Quality): Phases 13-16 — no cross-dependencies
- **Phase 17** (Tech Debt Register): Depends on all of Phases 1-16
- **Phase 18** (Risk Register): Depends on Phase 17
- **Phase 19** (Scorecard & Roadmap): Depends on Phases 17-18

## Parallel Opportunities

- All 5 groups can run in parallel once Phase 0 completes (5 agents = ~1/5 total time)
- Within each group, all phases can run in parallel
- Within each phase, [P]-marked tasks can run in parallel
- Phase 17-19 are strictly sequential (each depends on the prior)

## Implementation Strategy

### Full Audit (All 19 Phases)

1. Complete Phase 0: Setup
2. Launch Groups 1-5 in parallel
3. Each group completes its phases independently
4. Run Phase 17: Consolidate all findings
5. Run Phase 18: Derive risks
6. Run Phase 19: Score, roadmap, final verdict

### Quick Audit (P1 Phases Only)

1. Complete Phase 0: Setup
2. Run only Group 3: Security, CI/CD, Docker (Phases 8-10)
3. Run only Phase 12: Observability
4. Skip to Phase 17 for consolidated findings
5. Produce quick report

### Targeted Audit (Single Dimension)

1. Complete Phase 0: Setup
2. Run only the target phase (e.g., Phase 8: Security)
3. Produce single-phase report with findings and recommendations
