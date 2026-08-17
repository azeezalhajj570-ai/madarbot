# API Contracts: Workspace Member Invitations

## New Endpoints

All endpoints are dual-mounted at `/api/workspace/...` and `/webapp/workspace/...`.

Auth: All endpoints require `WORKSPACE_BOUNDARY` (admin or agents boundary) except `GET /invitations/pending` and the accept/decline endpoints (which require standard dashboard auth).

---

### `POST /api/workspace/{workspace_id}/invitations`

Create a pending workspace invitation.

**Auth**: Owner or Admin of the workspace.

**Request**:
```json
{
  "identifier": "@johndoe",
  "role": "member"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `identifier` | string | yes | Telegram `@username` or numeric user ID |
| `role` | string | no | `admin`, `member`, or `viewer`. Default: `member`. `owner` is not allowed. |

**Response**: `201 Created`
```json
{
  "id": 42,
  "invited_user_id": 55,
  "invited_username": "johndoe",
  "invited_full_name": "John Doe",
  "role": "member",
  "status": "pending",
  "created_at": "2026-08-17T12:00:00Z",
  "expires_at": "2026-08-24T12:00:00Z",
  "inviter_user_id": 10
}
```

**Errors**:
- `403` — Caller is not owner/admin of the workspace.
- `404` — Target user not found by identifier.
- `409` — Target user is already a member of this workspace.
- `409` — A pending invitation already exists for this user in this workspace.
- `422` — Invalid role (e.g., `owner`) or missing identifier.

---

### `GET /api/workspace/{workspace_id}/invitations`

List all invitations for a workspace (all statuses).

**Auth**: Owner or Admin of the workspace.

**Response**: `200 OK`
```json
{
  "invitations": [
    {
      "id": 42,
      "invited_user_id": 55,
      "invited_username": "johndoe",
      "invited_full_name": "John Doe",
      "inviter_user_id": 10,
      "inviter_username": "alice",
      "inviter_full_name": "Alice Smith",
      "role": "member",
      "status": "pending",
      "created_at": "2026-08-17T12:00:00Z",
      "expires_at": "2026-08-24T12:00:00Z",
      "accepted_at": null,
      "declined_at": null,
      "revoked_at": null
    }
  ]
}
```

**Note**: The `token` field is NOT included in list responses.

---

### `GET /api/workspace/invitations/pending`

List the authenticated user's own pending invitations across all workspaces.

**Auth**: Any authenticated user.

**Response**: `200 OK`
```json
{
  "invitations": [
    {
      "id": 42,
      "workspace_id": 7,
      "workspace_name": "Marketing Team",
      "inviter_username": "alice",
      "inviter_full_name": "Alice Smith",
      "role": "member",
      "status": "pending",
      "token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "created_at": "2026-08-17T12:00:00Z",
      "expires_at": "2026-08-24T12:00:00Z"
    }
  ]
}
```

**Note**: This endpoint does NOT require `WORKSPACE_BOUNDARY`. It requires standard dashboard authentication. The `token` IS included in list responses (the invited user needs it for accept/decline operations).

---

### `POST /api/workspace/invitations/{token}/accept`

Accept a pending workspace invitation.

**Auth**: Any authenticated user. The invitation must belong to the authenticated user (verified server-side via `invited_user_id`).

**Response**: `200 OK`
```json
{
  "workspace_id": 7,
  "workspace_name": "Marketing Team",
  "role": "member",
  "status": "accepted"
}
```

**Errors**:
- `403` — Invitation does not belong to the authenticated user.
- `404` — Invitation not found by token.
- `409` — Invitation is not in `pending` status (already accepted/declined/expired/revoked).
- `410` — Invitation has expired (`expires_at < now()`).

**Note**: This endpoint does NOT require `WORKSPACE_BOUNDARY`. It uses standard dashboard auth and resolves `user_id` from the authenticated identity.

---

### `POST /api/workspace/invitations/{token}/decline`

Decline a pending workspace invitation.

**Auth**: Any authenticated user. The invitation must belong to the authenticated user.

**Response**: `200 OK`
```json
{
  "workspace_id": 7,
  "workspace_name": "Marketing Team",
  "status": "declined"
}
```

**Errors**:
- `403` — Invitation does not belong to the authenticated user.
- `404` — Invitation not found by token.
- `409` — Invitation is not in `pending` status.

**Note**: Idempotent — declining an already-declined invitation returns `200 OK` with the current status.

---

### `POST /api/workspace/{workspace_id}/invitations/{token}/revoke`

Revoke a pending workspace invitation.

**Auth**: Owner or Admin of the workspace.

**Response**: `200 OK`
```json
{
  "id": 42,
  "status": "revoked",
  "revoked_at": "2026-08-18T09:00:00Z"
}
```

**Errors**:
- `403` — Caller is not owner/admin of the workspace.
- `404` — Invitation not found by token in this workspace.
- `409` — Invitation is not in `pending` status.

---

### `POST /api/workspace/{workspace_id}/invitations/{token}/resend`

Resend a workspace invitation (extend expiration, send new notification).

**Auth**: Owner or Admin of the workspace.

**Response**: `200 OK`
```json
{
  "id": 42,
  "status": "pending",
  "expires_at": "2026-08-24T12:00:00Z"
}
```

**Behavior**:
- Extends `expires_at` to `now() + 7 days`.
- Sends a new in-app notification and optional Telegram DM.
- Only works on invitations with `pending` status.

**Errors**:
- `403` — Caller is not owner/admin of the workspace.
- `404` — Invitation not found by token in this workspace.
- `409` — Invitation is not in `pending` status.

---

## Modified Endpoints

### `POST /api/workspace/{workspace_id}/invite` — REMOVED

The existing direct-add endpoint is removed. It is replaced by `POST /api/workspace/{workspace_id}/invitations`.

**Rationale**: The new invitation endpoint subsumes the old one. The old endpoint created `TenantMembership` directly, which is the behavior we're moving away from. Removing it avoids confusion and maintains a single invitation pathway.

### `GET /api/workspace/{workspace_id}/members` — UNCHANGED

The members list endpoint continues to return only active `TenantMembership` records. It does NOT include pending invitations. Invitations are listed via the separate `GET /api/workspace/{workspace_id}/invitations` endpoint.

---

## Error Response Format

All error responses follow the existing FastAPI convention:

```json
{
  "detail": "Human-readable error message"
}
```

Status codes used: `403`, `404`, `409`, `410`, `422`.

---

## Token Security

- Tokens are UUID4 (128-bit random), stored as lowercase hex with hyphens (standard UUID format).
- Tokens are NOT exposed in list responses (`GET .../invitations`).
- Tokens ARE exposed in the `POST .../invitations` creation response (so the admin can share a link if desired).
- Accept/decline/revoke/resend operations use the token as the path parameter.
- The token is the only way to identify a specific invitation from the invited user's perspective.
