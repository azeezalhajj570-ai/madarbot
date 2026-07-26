# Spec: MCP OAuth Implementation

## Objective

Add OAuth 2.0 authorization support to the MadarBot MCP server so MCP clients (ChatGPT/OpenAI, Cursor, Claude Desktop) can authenticate via the standard OAuth flow instead of requiring a manually configured Bearer token.

The MCP server at `https://madar.azeez-tech.com/mcp` currently returns empty `{}` for its OAuth well-known endpoints, causing clients to reject it with "MCP server does not implement OAuth".

## Tech Stack

- Python 3.11 + FastAPI (existing)
- SQLAlchemy async (existing `MCPToken` model)
- Redis (existing, for temporary auth code storage)
- No new dependencies

## Commands

```
Build: docker compose build backend
Restart: docker compose up -d backend
Logs: docker compose logs --tail=50 backend
```

## Project Structure

```
bot/
├── mcp/
│   ├── auth.py            ← Existing: token verification
│   ├── oauth.py           ← NEW: OAuth endpoints (authorize, token)
│   ├── context.py         ← Existing: actor context
│   └── server.py          ← Existing: FastMCP server factory
├── dashboard/
│   ├── api/
│   │   ├── main.py        ← Existing: mounts MCP router
│   │   └── mcp_router.py  ← Existing: MCP JSON-RPC handler
│   └── frontend/
│       └── mcp-auth.html  ← NEW: OAuth consent page
├── db/
│   └── models/
│       └── mcp_token.py   ← Existing: MCPToken model (add scope column)
└── config.py              ← Existing: add OAuth settings
```

## Code Style

Follow existing patterns in `bot/mcp/`:
- Async functions with `async/await`
- Pydantic models for request/response schemas
- `logging` for diagnostics
- Error responses as JSON

## OAuth Flow

```
User clicks "Connect" in ChatGPT
         │
         ▼
ChatGPT opens user's browser to:
  GET /mcp/auth/authorize?response_type=code
                         &client_id=chatgpt
                         &redirect_uri=https://chatgpt.com/mcp/callback
                         &state=xyz
         │
         ▼
User sees consent page (/mcp/auth page)
 - Shows "MadarBot MCP wants to connect"
 - User clicks "Authorize" (authenticated via Telegram WebApp session)
         │
         ▼
Backend generates short-lived auth code (stored in Redis, TTL 10min)
Redirects to:
  redirect_uri?code=abc123&state=xyz
         │
         ▼
ChatGPT receives code, calls:
  POST /mcp/auth/token
  Content-Type: application/x-www-form-urlencoded
  grant_type=authorization_code
  code=abc123
  redirect_uri=https://chatgpt.com/mcp/callback
  client_id=chatgpt
         │
         ▼
Backend validates code, creates MCPToken
Returns:
  {
    "access_token": "mcp_abc...",
    "token_type": "bearer",
    "expires_in": 31536000
  }
         │
         ▼
ChatGPT calls POST /mcp/ with:
  Authorization: Bearer mcp_abc...
```

## Well-Known Endpoints

### `GET /mcp/.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://madar.azeez-tech.com",
  "authorization_endpoint": "https://madar.azeez-tech.com/mcp/auth/authorize",
  "token_endpoint": "https://madar.azeez-tech.com/mcp/auth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["tools"]
}
```

### `GET /mcp/.well-known/oauth-protected-resource`

```json
{
  "resource": "https://madar.azeez-tech.com/mcp",
  "scopes": ["tools"]
}
```

## Configuration (new settings in `bot/config.py`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_OAUTH_ENABLED` | `false` | Enable OAuth endpoints |
| `MCP_OAUTH_CLIENT_IDS` | `[]` | JSON array of allowed client IDs |
| `MCP_OAUTH_TOKEN_TTL_SECONDS` | `31536000` | Access token lifetime (1 year) |
| `MCP_OAUTH_CODE_TTL_SECONDS` | `600` | Auth code lifetime (10 min) |

## Endpoints

### `GET /mcp/auth` — Consent page
- Serves an HTML page (or redirects to frontend)
- User authenticates via existing Telegram WebApp session
- Shows client name and requested scopes
- "Authorize" / "Cancel" buttons

### `GET /mcp/auth/authorize` — Authorization endpoint
- Query params: `response_type`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`
- Validates client_id against allowlist
- Checks user is authenticated (existing Telegram WebApp init_data cookie/session)
- Stores auth code in Redis with TTL
- Redirects to `redirect_uri` with `code` and `state`

### `POST /mcp/auth/token` — Token endpoint
- Body: `grant_type`, `code`, `redirect_uri`, `client_id`, `code_verifier`
- Validates auth code from Redis
- Creates `MCPToken` record (reuses existing model + service)
- Returns `access_token`, `token_type`, `expires_in`

## Testing Strategy

- Manual test with ChatGPT:
  1. Enable `MCP_OAUTH_ENABLED=true` and configure `MCP_OAUTH_CLIENT_IDS`
  2. Add MCP server in ChatGPT with OAuth
  3. Complete auth flow end-to-end
- Unit tests for code generation, validation, token creation
- Verify well-known endpoints return correct metadata

## Boundaries

- **Always do:**
  - Validate redirect URIs against client_id
  - Use PKCE (code_challenge + code_verifier) for all flows
  - Store auth codes in Redis with TTL, single-use
  - Log OAuth errors at WARNING level

- **Ask first:**
  - Adding new grant types (client_credentials, refresh_token)
  - Changing token format
  - Removing PKCE requirement

- **Never do:**
  - Store plaintext tokens in Redis
  - Return the access token in URL redirects (only auth code)
  - Allow permanent (infinite) auth codes
  - Skip PKCE for public clients

## Success Criteria

1. `GET /.well-known/oauth-authorization-server` returns valid OAuth metadata
2. `GET /.well-known/oauth-protected-resource` returns valid resource metadata
3. Authorization flow completes end-to-end with ChatGPT
4. Access token created in `mcp_tokens` table after successful auth
5. Token works with `POST /mcp/` endpoints (existing Bearer middleware)
6. Invalid codes, expired codes, wrong client IDs return proper error responses
7. PKCE code_challenge/code_verifier verification works

## Open Questions

1. Should we support multiple OAuth clients or just one (ChatGPT)?
2. Should the consent page be a standalone HTML page or embedded in the existing frontend?
3. Do we need refresh token support, or is a 1-year token sufficient?
