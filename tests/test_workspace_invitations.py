from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from bot.db.models import (
    AuditLog,
    Tenant,
    TenantMembership,
    User,
    WorkspaceInvitation,
)
from bot.services.workspace_service import WorkspaceError, WorkspaceService


async def _create_workspace(session, owner_user_id: int) -> Tenant:
    tenant = Tenant(owner_user_id=owner_user_id, name="Test Workspace")
    session.add(tenant)
    await session.flush()
    session.add(TenantMembership(tenant_id=tenant.id, user_id=owner_user_id, role="owner"))
    await session.flush()
    return tenant


async def _create_user(session, tg_user_id: int, username: str = "user") -> User:
    user = User(tg_user_id=tg_user_id, username=username, full_name=f"User {tg_user_id}", language_code="en")
    session.add(user)
    await session.flush()
    return user


async def _add_member(session, tenant_id: int, user_id: int, role: str = "member") -> TenantMembership:
    m = TenantMembership(tenant_id=tenant_id, user_id=user_id, role=role)
    session.add(m)
    await session.flush()
    return m


# ── invitation creation ────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_creates_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    assert inv.status == "pending"
    assert inv.role == "member"
    assert inv.invited_user_id == target.id
    assert inv.inviter_user_id == owner.id
    assert inv.token
    assert inv.expires_at > inv.created_at


@pytest.mark.asyncio
async def test_admin_creates_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    admin = await _create_user(db_session, 1002, "admin")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, admin.id, "admin")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=admin.id, identifier="2001", role="viewer"
    )
    assert inv.status == "pending"
    assert inv.role == "viewer"


@pytest.mark.asyncio
async def test_member_cannot_create_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    member = await _create_user(db_session, 1002, "member")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, member.id, "member")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspaceError, match="Only workspace owners and admins"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=member.id, identifier="2001", role="member"
        )


@pytest.mark.asyncio
async def test_viewer_cannot_create_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    viewer = await _create_user(db_session, 1002, "viewer")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, viewer.id, "viewer")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspaceError, match="Only workspace owners and admins"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=viewer.id, identifier="2001", role="member"
        )


@pytest.mark.asyncio
async def test_invitation_for_unknown_identifier(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspaceError, match="No user found"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=owner.id, identifier="99999", role="member"
        )


@pytest.mark.asyncio
async def test_duplicate_pending_invitation_prevented(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )

    with pytest.raises(WorkspaceError, match="pending invitation already exists"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="admin"
        )


@pytest.mark.asyncio
async def test_already_member_cannot_be_invited(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    member = await _create_user(db_session, 2001, "member")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, member.id, "member")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspaceError, match="already a member"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
        )


@pytest.mark.asyncio
async def test_owner_role_cannot_be_invited(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspaceError, match="Invalid role.*Owner role cannot"):
        await svc.create_invitation(
            tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="owner"
        )


# ── invitation acceptance ──────────────────────────────────────


@pytest.mark.asyncio
async def test_invitation_acceptance(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="admin"
    )
    await db_session.commit()

    membership = await svc.accept_invitation(token=inv.token, user_id=target.id)
    assert membership.tenant_id == tenant.id
    assert membership.user_id == target.id
    assert membership.role == "admin"

    inv_refreshed = await db_session.get(WorkspaceInvitation, inv.id)
    assert inv_refreshed.status == "accepted"
    assert inv_refreshed.accepted_at is not None


@pytest.mark.asyncio
async def test_wrong_user_cannot_accept(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    other = await _create_user(db_session, 2002, "other")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    with pytest.raises(WorkspaceError, match="does not belong to you"):
        await svc.accept_invitation(token=inv.token, user_id=other.id)


@pytest.mark.asyncio
async def test_expired_invitation_rejected(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )

    inv.expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    with pytest.raises(WorkspaceError, match="expired"):
        await svc.accept_invitation(token=inv.token, user_id=target.id)

    inv_refreshed = await db_session.get(WorkspaceInvitation, inv.id)
    assert inv_refreshed.status == "expired"


@pytest.mark.asyncio
async def test_revoked_invitation_cannot_be_accepted(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.revoke_invitation(token=inv.token, tenant_id=tenant.id, actor_user_id=owner.id)

    with pytest.raises(WorkspaceError, match="already been revoked"):
        await svc.accept_invitation(token=inv.token, user_id=target.id)


@pytest.mark.asyncio
async def test_repeated_accept_is_idempotent(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.accept_invitation(token=inv.token, user_id=target.id)
    with pytest.raises(WorkspaceError, match="already been accepted"):
        await svc.accept_invitation(token=inv.token, user_id=target.id)


# ── invitation decline ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_invitation_decline(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.decline_invitation(token=inv.token, user_id=target.id)

    inv_refreshed = await db_session.get(WorkspaceInvitation, inv.id)
    assert inv_refreshed.status == "declined"
    assert inv_refreshed.declined_at is not None

    count = (
        await db_session.execute(
            select(TenantMembership).where(
                TenantMembership.tenant_id == tenant.id,
                TenantMembership.user_id == target.id,
            )
        )
    ).scalars().all()
    assert len(count) == 0


@pytest.mark.asyncio
async def test_repeated_decline_is_idempotent(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.decline_invitation(token=inv.token, user_id=target.id)
    await svc.decline_invitation(token=inv.token, user_id=target.id)

    inv_refreshed = await db_session.get(WorkspaceInvitation, inv.id)
    assert inv_refreshed.status == "declined"


# ── invitation revocation ──────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_revokes_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    revoked = await svc.revoke_invitation(token=inv.token, tenant_id=tenant.id, actor_user_id=owner.id)
    assert revoked.status == "revoked"
    assert revoked.revoked_at is not None


@pytest.mark.asyncio
async def test_member_cannot_revoke_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    member = await _create_user(db_session, 1002, "member")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, member.id, "member")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    with pytest.raises(WorkspaceError, match="Only workspace owners and admins"):
        await svc.revoke_invitation(token=inv.token, tenant_id=tenant.id, actor_user_id=member.id)


# ── invitation resend ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_resend_invitation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    old_expires = inv.expires_at
    await db_session.commit()

    resent = await svc.resend_invitation(token=inv.token, tenant_id=tenant.id, actor_user_id=owner.id)
    assert resent.expires_at > old_expires


# ── auto-revoke on member removal ──────────────────────────────


@pytest.mark.asyncio
async def test_auto_revoke_on_member_removal(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    admin = await _create_user(db_session, 1002, "admin")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await _add_member(db_session, tenant.id, admin.id, "admin")
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.remove_member(tenant_id=tenant.id, actor_user_id=owner.id, target_user_id=admin.id)

    inv_refreshed = await db_session.get(WorkspaceInvitation, inv.id)
    assert inv_refreshed.status == "revoked"


# ── listing invitations ────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_invitations_for_workspace(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target1 = await _create_user(db_session, 2001, "target1")
    target2 = await _create_user(db_session, 2002, "target2")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2002", role="viewer"
    )
    await db_session.commit()

    invitations = await svc.list_invitations(tenant.id)
    assert len(invitations) == 2


@pytest.mark.asyncio
async def test_list_pending_invitations_for_user(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    pending = await svc.list_user_pending_invitations(target.id)
    assert len(pending) == 1
    assert pending[0]["token"] == inv.token
    assert pending[0]["workspace_name"] == "Test Workspace"


# ── audit logging ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_log_on_creation(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    logs = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "invitation.created",
            )
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].target_id == str(inv.id)


@pytest.mark.asyncio
async def test_audit_log_on_acceptance(db_session) -> None:
    owner = await _create_user(db_session, 1001, "owner")
    target = await _create_user(db_session, 2001, "target")
    tenant = await _create_workspace(db_session, owner.id)
    await db_session.commit()

    svc = WorkspaceService(db_session)
    inv = await svc.create_invitation(
        tenant_id=tenant.id, inviter_user_id=owner.id, identifier="2001", role="member"
    )
    await db_session.commit()

    await svc.accept_invitation(token=inv.token, user_id=target.id)

    logs = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "invitation.accepted",
            )
        )
    ).scalars().all()
    assert len(logs) == 1
