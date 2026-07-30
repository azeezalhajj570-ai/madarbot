# API Contracts: Multi-User Workspace MVP

## New Endpoints

### `GET /webapp/workspace`
Current user's workspace(s) and memberships.

**Response**:
```json
{
  "workspaces": [
    {
      "id": 1,
      "name": "My Workspace",
      "slug": "my-workspace",
      "role": "owner",
      "member_count": 3,
      "subscription": { "plan": "pro", "status": "active" }
    }
  ]
}
```

### `POST /webapp/workspace`
Create a new workspace. Only for users without a workspace (auto-created on first login generally).

**Request**:
```json
{ "name": "My Team Workspace" }
```

**Response**: `201` with workspace object.

### `GET /webapp/workspace/{id}/members`
List workspace members.

**Response**:
```json
{
  "members": [
    { "user_id": 42, "username": "john", "full_name": "John", "role": "owner", "joined_at": "..." },
    { "user_id": 55, "username": "jane", "full_name": "Jane", "role": "member", "joined_at": "..." }
  ]
}
```

### `POST /webapp/workspace/{id}/invite`
Invite a user by Telegram username or user ID.

**Request**:
```json
{ "identifier": "@johndoe", "role": "member" }
```

**Response**: `201` — invited user gets a notification on next dashboard load.

### `DELETE /webapp/workspace/{id}/members/{user_id}`
Remove a member from the workspace. Owner cannot remove themselves.

**Response**: `204`

### `PATCH /webapp/workspace/{id}/members/{user_id}/role`
Change a member's role.

**Request**:
```json
{ "role": "admin" }
```

**Response**: `200`

## Modified Endpoints

### All existing agent/group list endpoints
Add implicit `tenant_id` filter from the authenticated user's active workspace.

**Before**: `Agent.linked_by_user_id == current_user_id`
**After**: `Agent.tenant_id == active_workspace_id`

The `active_workspace_id` is determined by:
1. User's workspace membership (if only one, auto-select)
2. If multiple, user picks via workspace switcher (stored in session/state)

## Auth Pattern

```
get_identity()
  → resolves current user
  → resolves their active workspace(s)
  → injects active_workspace_id into request state

All scoped queries filter by active_workspace_id
```
