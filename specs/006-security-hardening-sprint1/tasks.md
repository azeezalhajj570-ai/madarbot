# Tasks: Security Hardening Sprint 1 — Critical Vulnerability Remediation

**Input**: Design documents from `specs/006-security-hardening-sprint1/`

**Prerequisites**: plan.md, spec.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)

---

## Phase 1: Foundation — Bcrypt + Config Validation

**Purpose**: Install bcrypt dependency, update config.py with required-secret validation

**Blocks**: Phase 2 (bcrypt needed for US2 auth rewrite), US3/US4 config validation

- [ ] T001 [P] Add `bcrypt` to `pyproject.toml` dependencies — `bcrypt>=4.2.0`
- [ ] T002 [P] Add startup validation in `bot/config.py` — validate `DASHBOARD_JWT_SECRET` is set (log CRITICAL and raise if missing)
- [ ] T003 [P] Add startup validation in `bot/config.py` — validate `SESSION_ENCRYPTION_KEY` is set when encryption is expected (log CRITICAL and raise if missing)
- [ ] T004 [P] Add startup validation in `bot/config.py` — validate `MCP_AUTH_TOKEN` is set when `MCP_ENABLED=true` (log CRITICAL and raise if missing)
- [ ] T005 [P] Add `SESSION_ENCRYPTION_KEY` and `DASHBOARD_JWT_SECRET` to `.env.example` with placeholder values and "REQUIRED" comments

**Checkpoint**: Server refuses to start if any required secret is missing. `.env.example` documents all required variables.

---

## Phase 2: Authenticate Unsecured Endpoints (US1)

**Purpose**: Close all unauthenticated endpoint holes

**Depends on**: Phase 1 (none directly, but config safety is baseline)

- [ ] T006 [US1] Add `Depends(require_bot_owner)` to `POST /pilot/test` in `bot/dashboard/api/routers/internal.py`
- [ ] T007 [US1] Reject client-provided `api_key` in `/pilot/test` request body — only server-configured API keys may be used
- [ ] T008 [US1] Add provider URL allowlist validation in `/pilot/test` — only allow `api.openai.com`, `generativelanguage.googleapis.com`, `openrouter.ai` domains
- [ ] T009 [US1] Add `Depends(require_bot_owner)` to `POST /api/agents/jobs/reconcile-stale` in `bot/dashboard/api/routers/agents.py`
- [ ] T010 [US1] Add `Depends(require_bot_owner)` to `GET /settings/schema` in `bot/dashboard/api/routers/internal.py`

**Checkpoint**: `curl` without auth returns 401 on all three endpoints. `/pilot/test` with auth refuses non-whitelisted URLs and client-provided API keys.

---

## Phase 3: Bcrypt Dashboard Authentication (US2)

**Purpose**: Replace plaintext password comparison with bcrypt

**Depends on**: Phase 1 (T001 — bcrypt dependency installed)

- [ ] T011 [US2] Update `DashboardBrowserUser` in `bot/config.py` — change `password` field to `password_hash` with a validator that detects if the value is a bcrypt hash (starts with `$2b$` or `$2a$`)
- [ ] T012 [US2] Rewrite `authenticate_browser_user` in `bot/dashboard/api/auth.py` — use `bcrypt.checkpw(password.encode(), user.password_hash.encode())` instead of `hmac.compare_digest`
- [ ] T013 [US2] Make `_dashboard_jwt_secret()` in `bot/dashboard/api/auth.py` raise `RuntimeError` if `DASHBOARD_JWT_SECRET` is not set — remove fallback to `bot_token`
- [ ] T014 [US2] Update `_hash_password` in `bot/services/messaging_service.py` — replace SHA-256 with bcrypt for any password hashing paths

**Checkpoint**: Dashboard login with bcrypt-hashed password succeeds. Login with wrong password fails. JWT secret fallback to bot token is removed.

---

## Phase 4: Encryption Startup Guard (US3)

**Purpose**: Ensure session strings are never stored in plaintext

**Depends on**: Phase 1 (T003 — config validation)

- [ ] T015 [US3] Add startup-time validation in `bot/utils/encryption.py` — `_get_fernet()` raises `RuntimeError("SESSION_ENCRYPTION_KEY is not configured — session strings would be stored in plaintext")` when key is missing, instead of silently returning `None`
- [ ] T016 [US3] Wire the encryption guard into `bot/main.py` and `bot/dashboard/api/main.py` — call encryption validation during lifespan startup so the application fails fast

**Checkpoint**: Removing `SESSION_ENCRYPTION_KEY` from `.env` causes the application to log CRITICAL and refuse to start.

---

## Phase 5: MCP & Token Hardening (US4)

**Purpose**: Close token leakage paths and enforce MCP auth

**Depends on**: Phase 1 (T004 — MCP_AUTH_TOKEN validation)

- [ ] T017 [US4] Update `verify_mcp_auth` in `bot/mcp/auth.py` — return `(False, None)` when `MCP_AUTH_TOKEN` is not set (currently returns `(True, None)` which opens MCP)
- [ ] T018 [US4] Remove query parameter token acceptance for MCP in `bot/dashboard/api/main.py` — delete `token = request.query_params.get("token")` from `McpAuthMiddleware.dispatch()`
- [ ] T019 [US4] Remove query parameter token acceptance for init_data in `bot/dashboard/api/auth.py` — remove `init_data: str | None = Query(default=None)` from `extract_dashboard_identity`
- [ ] T020 [US4] Reset `_mcp_actor_user_id` ContextVar after request completes in `bot/dashboard/api/main.py` — add `set_mcp_actor_user_id(None)` or use `contextlib.closing` pattern

**Checkpoint**: MCP without auth header returns 401. MCP with `?token=...` query param is rejected. init_data in URL query string is rejected.

---

## Phase 6: Campaign Authorization & Remaining Fixes (US5)

**Purpose**: Agent ownership checks and other high-severity fixes

**Depends on**: Phase 1 (config safety baseline)

- [ ] T021 [US5] Add agent ownership verification to all campaign CRUD endpoints in `bot/dashboard/api/routers/campaigns.py` — check that `agent_id` belongs to authenticated user via `LinkedAccountService`
- [ ] T022 [P] [US5] Switch Gemini API key from URL parameter to `x-goog-api-key` header in `bot/ai/providers.py` — change `?key={self.api_key}` to `headers["x-goog-api-key"] = self.api_key`
- [ ] T023 [P] [US5] Switch Gemini API key from URL parameter to `x-goog-api-key` header in `bot/plugins/ai_pilot/provider.py` — same change as T022
- [ ] T024 [P] [US5] Escape `%` and `_` characters in user-supplied search strings in `bot/services/scraper_service.py` — add `query = query.replace("%", "\\%").replace("_", "\\_")` before LIKE patterns
- [ ] T025 [US5] Add agent ownership check to `bot/services/messaging_service.py` — verify agent ownership in `_hash_password` and any agent-scoped operations

**Checkpoint**: User A cannot list/create/update/delete campaigns for user B's agent. Gemini API keys no longer appear in URLs. LIKE injection is prevented.

---

## Phase 7: Tests (All Stories)

**Purpose**: Verify each fix with automated tests

**Depends on**: Phases 2-6 (all implementation complete)

- [ ] T026 [P] [US1] Test: Unauthenticated request to `/pilot/test` returns 401 in `tests/test_auth.py`
- [ ] T027 [P] [US1] Test: Unauthenticated request to `/reconcile-stale` returns 401 in `tests/test_auth.py`
- [ ] T028 [P] [US1] Test: Authenticated `/pilot/test` with non-whitelisted URL returns 422 in `tests/test_auth.py`
- [ ] T029 [P] [US1] Test: Authenticated `/pilot/test` with client-provided api_key returns 422 in `tests/test_auth.py`
- [ ] T030 [P] [US2] Test: bcrypt login succeeds with correct password in `tests/test_auth.py`
- [ ] T031 [P] [US2] Test: bcrypt login fails with wrong password in `tests/test_auth.py`
- [ ] T032 [P] [US2] Test: `_dashboard_jwt_secret()` raises when secret is not configured in `tests/test_auth.py`
- [ ] T033 [P] [US3] Test: `encrypt_value()` raises when `SESSION_ENCRYPTION_KEY` is missing in `tests/test_encryption.py`
- [ ] T034 [P] [US3] Test: `encrypt_value()` produces ciphertext different from plaintext in `tests/test_encryption.py`
- [ ] T035 [P] [US3] Test: `decrypt_value()` recovers original plaintext in `tests/test_encryption.py`
- [ ] T036 [P] [US4] Test: MCP without auth header returns 401 in `tests/test_mcp.py`
- [ ] T037 [P] [US4] Test: MCP with `?token=` query param is rejected in `tests/test_mcp.py`
- [ ] T038 [P] [US5] Test: Campaign list for another user's agent returns 403 in `tests/test_campaigns.py`
- [ ] T039 [P] [US5] Test: Campaign create for another user's agent returns 403 in `tests/test_campaigns.py`
- [ ] T040 [P] [US5] Test: LIKE patterns with `%` and `_` are properly escaped in `tests/test_scraper_service.py`
- [ ] T041 Run full test suite — `pytest` — all existing tests + 16 new tests must pass

**Checkpoint**: `pytest` passes with zero failures. All 16 new tests cover the 5 user stories.

---

## Phase 8: Cross-Cutting — CI/CD & Documentation

**Purpose**: Ensure CI validates security changes and documentation is updated

**Depends on**: Phases 2-6 (implementation complete)

- [ ] T042 [P] Remove dead CI workflow `.github/workflows/ci.yml` — keep `tests.yml` only
- [ ] T043 [P] Update `docs/DEPLOYMENT_CHECKLIST.md` — add step to verify all required env vars are set before deploy
- [ ] T044 [P] Update `docs/DEVELOPMENT_WORKFLOW.md` — add security scanning step to pre-merge checklist
- [ ] T045 [P] Update `README.md` — remove duplicate content that overlaps with AGENTS.md/AGENT.md; fix port number inconsistencies
- [ ] T046 [P] Remove dead frontend artifacts — `bot/dashboard/frontend/combot_miniapp_preview.html`, `bot/dashboard/frontend/modbot/`, `bot/dashboard/frontend/channels/`
- [ ] T047 [P] Remove committed artifacts — `test-ci.sqlite3`, `tests/__pycache__/` directories

**Checkpoint**: Repository is clean — no dead files, no duplicate CI, documentation reflects current state.

---

## Phase Dependencies

- **Phase 1** (Foundation): No dependencies — can start immediately
- **Phase 2** (Auth endpoints): No dependencies on Phase 3+ — can run in parallel with Phase 1
- **Phase 3** (Bcrypt auth): Depends on Phase 1 T001 (bcrypt dependency)
- **Phase 4** (Encryption guard): Depends on Phase 1 T003 (config validation)
- **Phase 5** (MCP hardening): Depends on Phase 1 T004 (config validation)
- **Phase 6** (Campaign auth): No dependencies on other phases — can run in parallel
- **Phase 7** (Tests): Depends on Phases 2-6 (all implementation complete)
- **Phase 8** (CI/CD & docs): Can start in parallel with Phase 7

## Parallel Opportunities

- All Phase 1 tasks (T001-T005) can run in parallel
- Phases 2, 3, 4, 5, 6 can all run in parallel once Phase 1 foundation is complete (they touch different files)
- T022, T023, T024 can run in parallel (different files in Phase 6)
- All Phase 7 tests (T026-T040) marked [P] can run in parallel once implementation is complete
- All Phase 8 tasks (T042-T047) marked [P] can run in parallel

## Implementation Strategy

### MVP First (User Stories 1-3 Only)

1. Complete Phase 1: Foundation
2. Complete Phase 2: Auth endpoints (US1 — closes largest attack surface)
3. Complete Phase 3: Bcrypt auth (US2 — closes credential exposure)
4. Complete Phase 4: Encryption guard (US3 — prevents session data leak)
5. **STOP and VALIDATE**: Security scan confirms critical vulnerabilities are closed
6. **MVP deployed** — platform is no longer exploitable

### Incremental Delivery

1. MVP (US1-3) → Critical vulnerabilities closed
2. Add US4 → MCP and token hardening
3. Add US5 → Campaign authorization + remaining fixes
4. Phase 7 → Tests verify everything
5. Phase 8 → CI/CD and docs finalize
