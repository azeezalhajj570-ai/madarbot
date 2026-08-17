# Data Model: Workspace Member Invitations

## Existing Models (Reused, Unchanged)

### Tenant (`bot/db/models/messaging.py`)
```
Tenant
├── id: int (PK)
├── owner_user_id: FK → users.id
├── name: str(255)
├── slug: str(128) (unique, nullable)
├── is_active: bool
└── ...
```

### TenantMembership (`bot/db/models/tenant.py`)
```
TenantMembership
├── id: int (PK)
├── tenant_id: FK → tenants.id (CASCADE)
├── user_id: FK → users.id (CASCADE)
├── role: str(32) — "owner" | "admin" | "member" | "viewer"
├── is_active: bool
├── joined_at: datetime
├── created_at: datetime
├── updated_at: datetime
└── UNIQUE(tenant_id, user_id)
```

### User (`bot/db/models/user.py`)
```
User
├── id: int (PK)
├── tg_user_id: BigInteger (unique, nullable)
├── username: str(255) (nullable)
├── full_name: str(255) (nullable)
└── ...
```

### AuditLog (`bot/db/models/audit_log.py`)
```
AuditLog
├── id: int (PK)
├── tenant_id: int (nullable, indexed)
├── actor_type: str(32)
├── actor_id: str(64)
├── actor_tg_user_id: BigInteger (nullable)
├── action: str(64)
├── target_type: str(32)
├── target_id: str(64)
├── detail: JSON (nullable)
├── ip_address: str(45) (nullable)
└── created_at: datetime
```

## New Model

### WorkspaceInvitation (`bot/db/models/workspace_invitation.py`)

```python
class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "invited_user_id",
            name="uq_invitation_tenant_user_pending",
        ),
        # Note: This is a conditional unique constraint. PostgreSQL supports
        # partial unique indexes via Index with postgresql_where, but SQLAlchemy
        # UniqueConstraint doesn't directly support WHERE clauses.
        # Implementation options:
        #   1. Use a partial unique index via SQLAlchemy Index() with postgresql_where
        #   2. Use application-level checks (already done in WorkspaceService)
        #   3. Use a GiST exclusion constraint (overkill)
        #
        # Recommended: Use option 1 (partial unique index) for DB-level protection,
        # plus option 2 (application-level check) for clear error messages.
    )

    id: int (PK, autoincrement)
    tenant_id: int FK → tenants.id (NOT NULL, ON DELETE CASCADE)
    invited_user_id: int FK → users.id (NOT NULL, ON DELETE CASCADE)
    inviter_user_id: int FK → users.id (NOT NULL, ON DELETE CASCADE)
    role: str(32) NOT NULL — 'admin' | 'member' | 'viewer'
    status: str(20) NOT NULL DEFAULT 'pending' — 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
    token: str(64) NOT NULL UNIQUE — UUID4 hex
    created_at: datetime(timezone=True) NOT NULL DEFAULT now()
    expires_at: datetime(timezone=True) NOT NULL — created_at + 7 days
    accepted_at: datetime(timezone=True) NULLABLE
    declined_at: datetime(timezone=True) NULLABLE
    revoked_at: datetime(timezone=True) NULLABLE
    updated_at: datetime(timezone=True) NOT NULL DEFAULT now()
```

### Indexes

| Index Name | Columns | Type | Notes |
|------------|---------|------|-------|
| `ix_workspace_invitations_tenant_id` | `tenant_id` | B-tree | Scoped queries |
| `ix_workspace_invitations_invited_user_id` | `invited_user_id` | B-tree | User's pending invitations |
| `ix_workspace_invitations_inviter_user_id` | `inviter_user_id` | B-tree | Inviter's history |
| `ix_workspace_invitations_status` | `status` | B-tree | Filter by status |
| `ix_workspace_invitations_token` | `token` | B-tree (UNIQUE) | Token lookup |
| `ix_workspace_invitations_created_at` | `created_at` | B-tree | Sorting |

### Partial Unique Index (Duplicate Prevention)

```sql
CREATE UNIQUE INDEX uq_invitation_pending_per_user
ON workspace_invitations (tenant_id, invited_user_id)
WHERE status = 'pending';
```

This prevents multiple active invitations for the same user in the same workspace while allowing historical records (accepted, declined, expired, revoked) to coexist.

In SQLAlchemy:
```python
from sqlalchemy import Index

Index(
    "uq_invitation_pending_per_user",
    cls.tenant_id,
    cls.invited_user_id,
    unique=True,
    postgresql_where="status = 'pending'",
)
```

### Relationships

```
Tenant (1) ──── (N) WorkspaceInvitation  (tenant_id)
User   (1) ──── (N) WorkspaceInvitation  (invited_user_id)
User   (1) ──── (N) WorkspaceInvitation  (inviter_user_id)
```

No ORM relationship declarations needed on Tenant/User — the invitation queries are explicit joins.

## Modified Models

**None.** This feature adds a new table without modifying existing models.

## Migration Plan

1. Create `workspace_invitations` table with all columns.
2. Add foreign keys to `tenants.id`, `users.id` (×2).
3. Add all B-tree indexes.
4. Add the partial unique index `uq_invitation_pending_per_user`.
5. Add the `token` UNIQUE index.

No backfill required — no existing data to migrate.

## State Transition Guards

The `WorkspaceService` enforces valid state transitions at the application level:

| Operation | Guard Conditions |
|-----------|-----------------|
| `create_invitation()` | Target user exists, not already a member, no existing `pending` invitation for same (tenant, user) |
| `accept_invitation(token, user_id)` | Invitation exists, `invited_user_id == user_id`, `status == 'pending'`, `expires_at > now()` |
| `decline_invitation(token, user_id)` | Invitation exists, `invited_user_id == user_id`, `status == 'pending'` |
| `revoke_invitation(token, tenant_id)` | Invitation exists, `tenant_id` matches, `status == 'pending'` |
| `resend_invitation(token, tenant_id)` | Invitation exists, `tenant_id` matches, `status == 'pending'` |
| `revoke_user_invitations(tenant_id, user_id)` | Auto-revoke all pending invitations for a user when they are removed from the workspace |

### Auto-Revocation on Member Removal

When `WorkspaceService.remove_member()` is called and succeeds, all pending invitations for the removed user in that workspace are automatically revoked:

```python
async def remove_member(self, *, tenant_id, actor_user_id, target_user_id):
    # ... existing removal logic ...
    target_membership.is_active = False
    # Auto-revoke pending invitations
    await self._revoke_user_pending_invitations(tenant_id, target_user_id)
    await self.session.commit()
```

The partial unique index provides a database-level safety net for duplicate prevention, but the primary guard is in the service layer (which provides clear error messages).
