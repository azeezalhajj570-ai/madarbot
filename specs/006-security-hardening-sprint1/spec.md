# Feature Specification: Security Hardening Sprint 1 — Critical Vulnerability Remediation

**Feature Branch**: `006-security-hardening-sprint1`

**Created**: 2026-07-03

**Status**: Draft

**Input**: Comprehensive repository audit identified 3 critical and 9 high-severity security vulnerabilities. This sprint remediates all exploitable attack vectors before production scale-up.

## User Scenarios & Testing

### User Story 1 — Platform Owner Controls All API Access (Priority: P1)

As a platform owner, I want every API endpoint to require authentication, so that unauthorized users cannot exfiltrate AI API keys, trigger SSRF attacks, or manipulate agent jobs.

**Why this priority**: Three unauthenticated endpoints (`/pilot/test`, `/api/agents/jobs/reconcile-stale`, `/settings/schema`) expose the platform to SSRF, API key theft, and unauthorized job manipulation. This is the highest-risk attack surface.

**Independent Test**: Can be tested by sending unauthenticated HTTP requests to each endpoint and verifying a 401/403 response. Delivers immediate security value — the platform is no longer exploitable by unauthenticated attackers.

**Acceptance Scenarios**:

1. **Given** no authentication credentials are provided, **When** a POST request is sent to `/pilot/test`, **Then** the endpoint returns 401 Unauthorized.
2. **Given** no authentication credentials are provided, **When** a POST request is sent to `/api/agents/jobs/reconcile-stale`, **Then** the endpoint returns 401 Unauthorized.
3. **Given** no authentication credentials are provided, **When** a GET request is sent to `/settings/schema`, **Then** the endpoint returns 401 Unauthorized.
4. **Given** an authenticated owner sends a POST to `/pilot/test` with a whitelisted provider URL, **Then** the endpoint works as expected.

---

### User Story 2 — Dashboard Credentials Are Never Stored in Plaintext (Priority: P1)

As a platform operator, I want dashboard browser user passwords to be stored as bcrypt hashes, so that a leak of the environment file does not expose all admin credentials.

**Why this priority**: Plaintext passwords in `DASHBOARD_BROWSER_USERS` env var mean anyone with `.env` access (a common CI/ticket/backup leak) can read all admin passwords.

**Independent Test**: Can be tested by setting a known password via environment variable, starting the server, and verifying the password works for login. The raw password should never be comparable via string equality to the stored value.

**Acceptance Scenarios**:

1. **Given** a `DashboardBrowserUser` is configured with password `"my_secret"`, **When** the password is read from the environment and stored, **Then** `stored_value != "my_secret"` (it is a bcrypt hash).
2. **Given** a stored bcrypt hash, **When** a user logs in with the correct password, **Then** authentication succeeds.
3. **Given** a stored bcrypt hash, **When** a user logs in with an incorrect password, **Then** authentication fails.

---

### User Story 3 — Telegram Session Strings Are Always Encrypted at Rest (Priority: P1)

As a platform operator, I want Telegram session strings to be encrypted in the database using the configured encryption key, and if the key is missing the application must refuse to start, so that compromised database dumps do not expose Telegram account credentials.

**Why this priority**: Session strings grant full control over linked Telegram accounts. If `SESSION_ENCRYPTION_KEY` is not configured, `encrypt_value()` silently returns plaintext. This is a catastrophic data leak waiting to happen.

**Independent Test**: Can be tested by removing `SESSION_ENCRYPTION_KEY` from `.env` and verifying the application logs a critical error and refuses to start.

**Acceptance Scenarios**:

1. **Given** `SESSION_ENCRYPTION_KEY` is not set in the environment, **When** the application starts, **Then** it logs a CRITICAL error and does not proceed with agent operations.
2. **Given** `SESSION_ENCRYPTION_KEY` is configured, **When** a session string is stored, **Then** the database value is not equal to the raw session string (it is encrypted).
3. **Given** `SESSION_ENCRYPTION_KEY` is configured, **When** a session string is retrieved, **Then** it is correctly decrypted to the original value.

---

### User Story 4 — JWT and MCP Tokens Cannot Be Forged (Priority: P1)

As a platform operator, I want all tokens and secrets to be independently configured and required, so that a compromise of one secret does not cascade to all others.

**Why this priority**: `DASHBOARD_JWT_SECRET` falls back to `BOT_TOKEN`, and `MCP_AUTH_TOKEN` when unset opens MCP to the world. These create single points of failure.

**Independent Test**: Can be tested by removing each required secret and verifying the application refuses to start or returns 401 on the affected endpoints.

**Acceptance Scenarios**:

1. **Given** `DASHBOARD_JWT_SECRET` is not configured, **When** the application starts, **Then** it logs a CRITICAL error and refuses to serve authenticated routes.
2. **Given** `MCP_AUTH_TOKEN` is not configured but `MCP_ENABLED=true`, **When** the application starts, **Then** it logs a CRITICAL error and does not enable MCP.
3. **Given** all secrets are properly configured, **When** a user authenticates with a valid JWT, **Then** authentication succeeds.

---

### User Story 5 — Campaign Operations Verify Agent Ownership (Priority: P2)

As a platform owner, I want campaign endpoints to verify that the authenticated user owns the agent being operated on, so that one user cannot read or modify another user's campaigns.

**Why this priority**: All campaign endpoints capture the authenticated identity but never check it against agent ownership. Any authenticated user can CRUD any agent's campaigns.

**Independent Test**: Can be tested by authenticating as user A, then attempting to list/create/update/delete campaigns for user B's agent, and verifying a 403 Forbidden response.

**Acceptance Scenarios**:

1. **Given** user A is authenticated with `tg_user_id=1`, **When** user A requests campaigns for an agent owned by user B (`tg_user_id=2`), **Then** the endpoint returns 403 Forbidden.
2. **Given** user A is authenticated, **When** user A requests campaigns for their own agent, **Then** the endpoint returns the expected data.

---

### Edge Cases

- What happens when the bcrypt hash in the environment variable is invalid or corrupted?
- What happens when a session string was encrypted with an old key and needs to be re-encrypted?
- What happens when an unauthenticated request includes a valid-looking but expired token?
- What happens when the pilot test endpoint receives a provider URL that passes the whitelist but redirects to a malicious domain?
- What happens when a campaign exists for an agent that has been deleted?

## Requirements

### Functional Requirements

- **FR-001**: System MUST require authentication on `/pilot/test`, `/api/agents/jobs/reconcile-stale`, and `/settings/schema` endpoints.
- **FR-002**: System MUST validate `provider_url` in `/pilot/test` against an allowlist of known AI API domains (api.openai.com, generativelanguage.googleapis.com, openrouter.ai).
- **FR-003**: System MUST NOT accept API keys from the client request body in `/pilot/test` — only server-configured keys may be used.
- **FR-004**: System MUST store dashboard browser user passwords as bcrypt hashes, not plaintext.
- **FR-005**: System MUST validate login by comparing input against the bcrypt hash using `bcrypt.checkpw()`.
- **FR-006**: System MUST refuse to start agent operations when `SESSION_ENCRYPTION_KEY` is not configured, logging a CRITICAL error.
- **FR-007**: System MUST make `DASHBOARD_JWT_SECRET` a required configuration — no fallback to `BOT_TOKEN`.
- **FR-008**: System MUST require `MCP_AUTH_TOKEN` when `MCP_ENABLED=true` — refuse to enable MCP without it.
- **FR-009**: System MUST remove query parameter token acceptance for MCP and init_data authentication — header-only for tokens.
- **FR-010**: System MUST verify agent ownership on all campaign CRUD endpoints — the authenticated user must own the agent.
- **FR-011**: System MUST escape `%` and `_` characters in user-supplied search strings before embedding in SQL LIKE patterns.
- **FR-012**: System MUST use `x-goog-api-key` header instead of URL query parameter for Gemini API authentication.

### Key Entities

- **DashboardBrowserUser**: Extends existing model — `password` field transitions from plaintext to bcrypt hash. No structural change, only encoding change.
- **SessionEncryptionConfig**: No new entity — existing `encrypt_value`/`decrypt_value` functions gain a startup guard that checks key presence.
- **CampaignAuthorizationCheck**: No new entity — existing campaign endpoints gain a middleware check against agent ownership via `LinkedAccountService`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All API endpoints return 401/403 for unauthenticated requests — verified by automated security scan.
- **SC-002**: Dashboard login works correctly with bcrypt-hashed passwords — zero login regressions.
- **SC-003**: Application refuses to start if `SESSION_ENCRYPTION_KEY` is missing — verified by startup test.
- **SC-004**: All existing tests pass after all changes — zero regressions.
- **SC-005**: No secrets appear in application logs — verified by scanning log output during test runs.
- **SC-006**: Campaign endpoints enforce agent ownership — verified by integration test.

## Assumptions

- Existing bcrypt library can be added as a dependency without conflicts.
- The `DashboardBrowserUser` model and `authenticate_browser_user` function are the only places that handle dashboard passwords.
- The `encrypt_value`/`decrypt_value` functions are the only code paths that handle session string encryption.
- Agent ownership can be verified via `LinkedAccountService` which maps agents to Telegram user IDs.
- The `DASHBOARD_JWT_SECRET` setting can be made required without breaking existing deployed instances — those instances can generate a new secret and update `.env`.
- API key whitelist for Gemini will switch from URL parameter to `x-goog-api-key` header in both `bot/ai/providers.py` and `bot/plugins/ai_pilot/provider.py`.
