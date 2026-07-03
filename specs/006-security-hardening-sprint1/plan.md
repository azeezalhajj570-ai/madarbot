# Implementation Plan: Security Hardening Sprint 1 — Critical Vulnerability Remediation

**Branch**: `006-security-hardening-sprint1` | **Date**: 2026-07-03 | **Spec**: `specs/006-security-hardening-sprint1/spec.md`

**Input**: Feature specification from `specs/006-security-hardening-sprint1/spec.md`

## Summary

Remediate 3 critical and 9 high-severity security vulnerabilities identified in the comprehensive repository audit. All changes are backend-only with zero user-facing UI changes. Work is organized into 5 user stories that can be implemented and tested independently, prioritized by risk.

## Technical Context

**Language/Version**: Python 3.11+

**Primary Dependencies**: bcrypt (new), existing: FastAPI, httpx, SQLAlchemy (async), cryptography

**Storage**: PostgreSQL 16 (no schema changes — all changes are application-layer)

**Testing**: pytest + pytest-asyncio (existing tests must all pass; new tests for auth, encryption, campaign authorization)

**Target Platform**: Linux server (Docker)

**Project Type**: Web application (FastAPI backend + Telegram bot)

**Performance Goals**: No measurable latency impact — all changes are in authentication paths that run once per request or startup

**Constraints**: Must not break existing authenticated sessions. Must not require database migrations. Must be deployable without downtime (env var additions are backward-compatible).

**Scale/Scope**: All changes are in `bot/dashboard/api/`, `bot/mcp/`, `bot/utils/`, and `bot/dashboard/api/routers/`. No frontend changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Security & Secrets | ✅ Pass | Primary objective — this sprint exists to satisfy this principle |
| II. Code Quality | ✅ Pass | Follows existing patterns; ruff + mypy required |
| III. Testing Standards | ✅ Pass | New tests for each fix; existing tests must pass |
| IV. UX Consistency | ✅ Pass | Backend-only changes; no user-facing impact |
| V. Performance | ✅ Pass | Zero overhead — auth checks are already in the request path |
| VI. Async-First | ✅ Pass | All I/O uses asyncio; bcrypt hashing is offloaded to executor |
| VII. Containerized | ✅ Pass | Dockerfile updates for new dependency (bcrypt) |
| VIII. Observability | ✅ Pass | Structured logging for security events (auth failures, encryption warnings) |

## Project Structure

### Documentation (this feature)

```text
specs/006-security-hardening-sprint1/
├── spec.md              # Feature specification
├── plan.md              # This file
└── tasks.md             # Implementation tasks
```

### Source Code

```text
bot/
├── config.py                               # MOD: make DASHBOARD_JWT_SECRET required
│                                             MOD: add SESSION_ENCRYPTION_KEY startup guard
├── dashboard/
│   ├── api/
│   │   ├── auth.py                          # MOD: bcrypt password hashing + validation
│   │   │                                      MOD: make JWT secret required
│   │   ├── main.py                          # MOD: MCP auth — remove query param support
│   │   │                                      MOD: remove init_data query param
│   │   └── routers/
│   │       ├── internal.py                  # MOD: add auth to /pilot/test endpoint
│   │       │                                    MOD: whitelist provider URLs
│   │       │                                    MOD: reject client-provided API keys
│   │       ├── agents.py                    # MOD: add auth to /reconcile-stale
│   │       └── campaigns.py                 # MOD: verify agent ownership
│   └── api/middleware/telegram_auth.py      # MOD: remove init_data query param
├── mcp/
│   ├── auth.py                              # MOD: require MCP_AUTH_TOKEN when MCP enabled
│   └── context.py                           # MOD: reset ContextVar after request
├── utils/
│   ├── encryption.py                        # MOD: guard on missing SESSION_ENCRYPTION_KEY
│   └── rate_limiter.py                      # (no change needed for this sprint)
├── ai/
│   └── providers.py                         # MOD: Gemini API key via header, not URL
├── plugins/
│   └── ai_pilot/
│       └── provider.py                      # MOD: Gemini API key via header, not URL
└── services/
    └── scraper_service.py                   # MOD: escape LIKE patterns in search queries
tests/
├── test_auth.py                             # NEW: bcrypt auth tests
├── test_encryption.py                       # NEW: startup guard tests
├── test_campaigns.py                        # NEW: ownership check tests
└── test_mcp.py                              # MOD: unskip and implement the 10 stub tests
```

**Structure Decision**: Single-project layout following existing conventions. All changes are in-place modifications to existing files plus new test files. No new directories needed.

## Implementation Phases

1. **Authenticate unsecured endpoints** — `internal.py`, `agents.py`: add `Depends(require_bot_owner)` to `/pilot/test`, `/reconcile-stale`, and `/settings/schema`. Whitelist provider URLs in pilot test.
2. **Bcrypt dashboard auth** — `auth.py`: replace `hmac.compare_digest` with `bcrypt.checkpw`. Update `DashboardBrowserUser` to expect hashed passwords. Make `DASHBOARD_JWT_SECRET` required.
3. **Encryption startup guard** — `encryption.py`: raise `RuntimeError` if `SESSION_ENCRYPTION_KEY` is missing and encryption is attempted. Update `config.py` to validate at startup.
4. **MCP and token hardening** — `mcp/auth.py`: require `MCP_AUTH_TOKEN` when enabled. `main.py`: remove query param token acceptance. `context.py`: reset ContextVar after request.
5. **Campaign authorization & remaining fixes** — `campaigns.py`: verify agent ownership. `providers.py`: Gemini API key via header. `scraper_service.py`: escape LIKE patterns. Tests.

## Key Design Decisions

1. **Dependency choice: bcrypt**: The `bcrypt` library is chosen over `argon2` or `passlib` because it is minimal, has no additional dependencies, and is the most widely deployed password hashing library in Python. The `cryptography` package (already a dependency) provides `bcrypt` via `cryptography.hazmat.primitives.kdf.pbkdf2` but for simplicity and auditability we use the standalone `bcrypt` package.

2. **Startup-time validation**: Rather than lazy-checking encryption keys at first use, we validate at startup. This fails fast and eliminates the window between boot and first encryption operation where data could be written in plaintext.

3. **Authentication method for pilot/test**: We use `Depends(require_bot_owner)` which checks against `BOT_OWNER_IDS` — the same mechanism used for other admin endpoints. This is consistent with the existing auth model and requires no new infrastructure.

4. **Provider URL allowlist**: Rather than implementing complex URL validation, we maintain an allowlist of known AI API domains. This is more restrictive but eliminates SSRF risk entirely. The allowlist covers OpenAI, Google Gemini, and OpenRouter.

5. **Gemini API key header**: The current URL-parameter approach leaks the key in server access logs. Switching to the `x-goog-api-key` header is Google's recommended approach and eliminates this leak entirely.

6. **Campaign ownership check**: We reuse `LinkedAccountService.get_agent_owner()` to verify that the authenticated user owns the agent. This is consistent with how other agent-scoped endpoints verify ownership.
