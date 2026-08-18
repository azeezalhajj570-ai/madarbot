from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import (
    AgentNotification,
    AuditLog,
    Tenant,
    TenantMembership,
    User,
    WorkspaceInvitation,
)



logger = logging.getLogger(__name__)

INVITATION_EXPIRY_DAYS = 7
VALID_ROLES = {"owner", "admin", "member", "viewer"}
INVITABLE_ROLES = {"admin", "member", "viewer"}
ROLES_THAT_CAN_MANAGE_INVITATIONS = {"owner", "admin"}
ROLES_THAT_CAN_MANAGE_MEMBERS = {"owner", "admin"}


class WorkspaceError(ValueError):
    pass


class WorkspaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── workspace CRUD ─────────────────────────────────────────────

    async def get_or_create_user_workspace(self, user_id: int) -> Tenant:
        existing = (
            await self.session.execute(select(Tenant).where(Tenant.owner_user_id == user_id))
        ).scalars().first()
        if existing is not None:
            return existing

        user = await self.session.get(User, user_id)
        name = (user.full_name if user and user.full_name else None) or "My Workspace"

        tenant = Tenant(owner_user_id=user_id, name=name)
        self.session.add(tenant)
        await self.session.flush()
        self.session.add(
            TenantMembership(tenant_id=tenant.id, user_id=user_id, role="owner")
        )
        await self.session.commit()
        return tenant

    async def list_user_memberships(self, user_id: int) -> list[TenantMembership]:
        return (
            (
                await self.session.execute(
                    select(TenantMembership).where(
                        TenantMembership.user_id == user_id,
                        TenantMembership.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )

    async def get_membership(self, *, tenant_id: int, user_id: int) -> TenantMembership | None:
        return (
            await self.session.execute(
                select(TenantMembership).where(
                    TenantMembership.tenant_id == tenant_id,
                    TenantMembership.user_id == user_id,
                    TenantMembership.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()

    async def list_members(self, tenant_id: int) -> list[dict]:
        rows = await self.session.execute(
            select(TenantMembership, User)
            .join(User, User.id == TenantMembership.user_id)
            .where(TenantMembership.tenant_id == tenant_id, TenantMembership.is_active.is_(True))
        )
        return [
            {
                "user_id": user.id,
                "tg_user_id": user.tg_user_id,
                "username": user.username,
                "full_name": user.full_name,
                "role": membership.role,
                "joined_at": membership.joined_at,
            }
            for membership, user in rows.all()
        ]

    async def remove_member(self, *, tenant_id: int, actor_user_id: int, target_user_id: int) -> None:
        actor_membership = await self.get_membership(tenant_id=tenant_id, user_id=actor_user_id)
        if actor_membership is None or actor_membership.role not in ROLES_THAT_CAN_MANAGE_MEMBERS:
            raise WorkspaceError("Only workspace owners and admins can remove members")

        if actor_user_id == target_user_id:
            raise WorkspaceError("Owners cannot remove themselves from the workspace")

        target_membership = await self.get_membership(tenant_id=tenant_id, user_id=target_user_id)
        if target_membership is None:
            raise WorkspaceError("Member not found")
        if target_membership.role == "owner":
            raise WorkspaceError("Cannot remove the workspace owner")

        target_membership.is_active = False
        await self._revoke_user_pending_invitations(tenant_id, target_user_id, actor_user_id=actor_user_id)
        await self.session.commit()

    async def change_role(
        self, *, tenant_id: int, actor_user_id: int, target_user_id: int, new_role: str
    ) -> TenantMembership:
        if new_role not in VALID_ROLES:
            raise WorkspaceError(f"Invalid role: {new_role}")

        actor_membership = await self.get_membership(tenant_id=tenant_id, user_id=actor_user_id)
        if actor_membership is None or actor_membership.role != "owner":
            raise WorkspaceError("Only the workspace owner can change member roles")

        target_membership = await self.get_membership(tenant_id=tenant_id, user_id=target_user_id)
        if target_membership is None:
            raise WorkspaceError("Member not found")
        if target_membership.role == "owner" and new_role != "owner":
            raise WorkspaceError("Cannot demote the workspace owner directly — transfer ownership first")

        target_membership.role = new_role
        await self.session.commit()
        return target_membership

    async def member_count(self, tenant_id: int) -> int:
        result = await self.session.execute(
            select(func.count(TenantMembership.id)).where(
                TenantMembership.tenant_id == tenant_id,
                TenantMembership.is_active.is_(True),
            )
        )
        return int(result.scalar_one())

    # ── invitation lifecycle ───────────────────────────────────────

    async def create_invitation(
        self,
        *,
        tenant_id: int,
        inviter_user_id: int,
        identifier: str,
        role: str = "member",
        telegram_client: Any | None = None,
    ) -> WorkspaceInvitation:
        if role not in INVITABLE_ROLES:
            raise WorkspaceError(f"Invalid role: {role}. Owner role cannot be assigned via invitation.")

        inviter_membership = await self.get_membership(tenant_id=tenant_id, user_id=inviter_user_id)
        if inviter_membership is None or inviter_membership.role not in ROLES_THAT_CAN_MANAGE_INVITATIONS:
            raise WorkspaceError("Only workspace owners and admins can create invitations")

        target_user = await self._resolve_identifier(identifier, telegram_client=telegram_client)
        if target_user is None:
            raise WorkspaceError("Telegram user not found")

        existing_membership = await self.get_membership(tenant_id=tenant_id, user_id=target_user.id)
        if existing_membership is not None:
            raise WorkspaceError("User is already a member of this workspace")

        existing_invitation = await self._get_pending_invitation_for_user(tenant_id, target_user.id)
        if existing_invitation is not None:
            raise WorkspaceError("A pending invitation already exists for this user in this workspace")

        now = datetime.now(timezone.utc)
        token = secrets.token_hex(16)
        invitation = WorkspaceInvitation(
            tenant_id=tenant_id,
            invited_user_id=target_user.id,
            inviter_user_id=inviter_user_id,
            role=role,
            status="pending",
            token=token,
            created_at=now,
            expires_at=now + timedelta(days=INVITATION_EXPIRY_DAYS),
        )
        self.session.add(invitation)
        await self.session.flush()

        await self._audit_invitation(
            tenant_id=tenant_id,
            actor_user_id=inviter_user_id,
            action="created",
            invitation_id=invitation.id,
        )
        await self._send_invitation_notification(invitation, target_user)
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def list_invitations(
        self, tenant_id: int, *, status: str | None = None
    ) -> list[dict]:
        now = datetime.now(timezone.utc)
        stmt = (
            select(WorkspaceInvitation, User)
            .join(User, User.id == WorkspaceInvitation.invited_user_id)
            .where(WorkspaceInvitation.tenant_id == tenant_id)
        )
        if status:
            stmt = stmt.where(WorkspaceInvitation.status == status)
        stmt = stmt.order_by(WorkspaceInvitation.created_at.desc())

        rows = await self.session.execute(stmt)
        results: list[dict] = []
        expired_ids: list[int] = []
        for invitation, invited_user in rows.all():
            if invitation.status == "pending" and invitation.expires_at <= now:
                invitation.status = "expired"
                invitation.updated_at = now
                expired_ids.append(invitation.id)
            inviter = await self.session.get(User, invitation.inviter_user_id)
            results.append(self._serialize_invitation(invitation, invited_user, inviter))
        if expired_ids:
            await self.session.flush()
        return results

    async def list_user_pending_invitations(self, user_id: int) -> list[dict]:
        now = datetime.now(timezone.utc)
        stmt = (
            select(WorkspaceInvitation, Tenant)
            .join(Tenant, Tenant.id == WorkspaceInvitation.tenant_id)
            .where(
                WorkspaceInvitation.invited_user_id == user_id,
                WorkspaceInvitation.status == "pending",
                WorkspaceInvitation.expires_at > now,
            )
            .order_by(WorkspaceInvitation.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        results: list[dict] = []
        for invitation, tenant in rows.all():
            inviter = await self.session.get(User, invitation.inviter_user_id)
            results.append({
                "id": invitation.id,
                "workspace_id": tenant.id,
                "workspace_name": tenant.name,
                "inviter_username": inviter.username if inviter else None,
                "inviter_full_name": inviter.full_name if inviter else None,
                "role": invitation.role,
                "status": invitation.status,
                "token": invitation.token,
                "created_at": invitation.created_at.isoformat() if invitation.created_at else None,
                "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
            })
        return results

    async def accept_invitation(self, *, token: str, user_id: int) -> TenantMembership:
        invitation = await self._get_invitation_by_token(token, for_update=True)
        if invitation is None:
            raise WorkspaceError("Invitation not found")

        if invitation.invited_user_id != user_id:
            raise WorkspaceError("This invitation does not belong to you")

        if invitation.status != "pending":
            raise WorkspaceError(f"Invitation has already been {invitation.status}")

        if invitation.expires_at <= datetime.now(timezone.utc):
            invitation.status = "expired"
            invitation.updated_at = datetime.now(timezone.utc)
            await self.session.flush()
            raise WorkspaceError("Invitation has expired")

        now = datetime.now(timezone.utc)
        invitation.status = "accepted"
        invitation.accepted_at = now
        invitation.updated_at = now

        membership = TenantMembership(
            tenant_id=invitation.tenant_id,
            user_id=user_id,
            role=invitation.role,
        )
        self.session.add(membership)
        await self.session.flush()

        await self._audit_invitation(
            tenant_id=invitation.tenant_id,
            actor_user_id=user_id,
            action="accepted",
            invitation_id=invitation.id,
        )
        await self.session.commit()
        return membership

    async def decline_invitation(self, *, token: str, user_id: int) -> None:
        invitation = await self._get_invitation_by_token(token)
        if invitation is None:
            raise WorkspaceError("Invitation not found")

        if invitation.invited_user_id != user_id:
            raise WorkspaceError("This invitation does not belong to you")

        if invitation.status != "pending":
            return

        now = datetime.now(timezone.utc)
        invitation.status = "declined"
        invitation.declined_at = now
        invitation.updated_at = now

        await self._audit_invitation(
            tenant_id=invitation.tenant_id,
            actor_user_id=user_id,
            action="declined",
            invitation_id=invitation.id,
        )
        await self.session.commit()

    async def revoke_invitation(
        self, *, token: str, tenant_id: int, actor_user_id: int
    ) -> WorkspaceInvitation:
        invitation = await self._get_invitation_by_token(token)
        if invitation is None or invitation.tenant_id != tenant_id:
            raise WorkspaceError("Invitation not found")

        actor_membership = await self.get_membership(tenant_id=tenant_id, user_id=actor_user_id)
        if actor_membership is None or actor_membership.role not in ROLES_THAT_CAN_MANAGE_INVITATIONS:
            raise WorkspaceError("Only workspace owners and admins can revoke invitations")

        if invitation.status != "pending":
            raise WorkspaceError(f"Invitation has already been {invitation.status}")

        now = datetime.now(timezone.utc)
        invitation.status = "revoked"
        invitation.revoked_at = now
        invitation.updated_at = now

        await self._audit_invitation(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="revoked",
            invitation_id=invitation.id,
        )
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def resend_invitation(
        self, *, token: str, tenant_id: int, actor_user_id: int
    ) -> WorkspaceInvitation:
        invitation = await self._get_invitation_by_token(token)
        if invitation is None or invitation.tenant_id != tenant_id:
            raise WorkspaceError("Invitation not found")

        actor_membership = await self.get_membership(tenant_id=tenant_id, user_id=actor_user_id)
        if actor_membership is None or actor_membership.role not in ROLES_THAT_CAN_MANAGE_INVITATIONS:
            raise WorkspaceError("Only workspace owners and admins can resend invitations")

        if invitation.status != "pending":
            raise WorkspaceError(f"Invitation has already been {invitation.status}")

        now = datetime.now(timezone.utc)
        invitation.expires_at = now + timedelta(days=INVITATION_EXPIRY_DAYS)
        invitation.updated_at = now

        invited_user = await self.session.get(User, invitation.invited_user_id)
        if invited_user:
            await self._send_invitation_notification(invitation, invited_user)

        await self._audit_invitation(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="resent",
            invitation_id=invitation.id,
        )
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    # ── internal helpers ───────────────────────────────────────────

    async def _get_invitation_by_token(
        self, token: str, *, for_update: bool = False
    ) -> WorkspaceInvitation | None:
        stmt = select(WorkspaceInvitation).where(WorkspaceInvitation.token == token)
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _get_pending_invitation_for_user(
        self, tenant_id: int, user_id: int
    ) -> WorkspaceInvitation | None:
        return (
            await self.session.execute(
                select(WorkspaceInvitation).where(
                    WorkspaceInvitation.tenant_id == tenant_id,
                    WorkspaceInvitation.invited_user_id == user_id,
                    WorkspaceInvitation.status == "pending",
                )
            )
        ).scalar_one_or_none()

    async def _revoke_user_pending_invitations(
        self, tenant_id: int, user_id: int, *, actor_user_id: int | None = None
    ) -> None:
        now = datetime.now(timezone.utc)
        result = await self.session.execute(
            select(WorkspaceInvitation).where(
                WorkspaceInvitation.tenant_id == tenant_id,
                WorkspaceInvitation.invited_user_id == user_id,
                WorkspaceInvitation.status == "pending",
            )
        )
        invitations = result.scalars().all()
        for inv in invitations:
            inv.status = "revoked"
            inv.revoked_at = now
            inv.updated_at = now
            if actor_user_id is not None:
                await self._audit_invitation(
                    tenant_id=tenant_id,
                    actor_user_id=actor_user_id,
                    action="revoked",
                    invitation_id=inv.id,
                )

    async def _audit_invitation(
        self, *, tenant_id: int, actor_user_id: int, action: str, invitation_id: int
    ) -> None:
        self.session.add(
            AuditLog(
                tenant_id=tenant_id,
                actor_type="user",
                actor_id=str(actor_user_id),
                action=f"invitation.{action}",
                target_type="workspace_invitation",
                target_id=str(invitation_id),
            )
        )

    async def _send_invitation_notification(
        self, invitation: WorkspaceInvitation, invited_user: User
    ) -> None:
        tenant = await self.session.get(Tenant, invitation.tenant_id)
        inviter = await self.session.get(User, invitation.inviter_user_id)
        workspace_name = tenant.name if tenant else "Unknown Workspace"
        inviter_name = (inviter.full_name or inviter.username or "Someone") if inviter else "Someone"

        notification = AgentNotification(
            agent_id=None,
            group_id=None,
            kind="workspace_invitation",
            title="Workspace Invitation",
            body=f"You've been invited to {workspace_name} as {invitation.role} by {inviter_name}.",
            payload={
                "invitation_token": invitation.token,
                "workspace_id": invitation.tenant_id,
                "workspace_name": workspace_name,
                "role": invitation.role,
                "inviter_name": inviter_name,
            },
            is_seen=False,
        )
        self.session.add(notification)

        if invited_user.tg_user_id is not None:
            try:
                from bot.utils.bot_pool import BotPool
                from bot.config import get_settings

                bot = await BotPool.get()
                settings = get_settings()
                dashboard_url = settings.webapp_url or settings.dashboard_url or ""

                text = (
                    f"You've been invited to workspace \"{workspace_name}\" "
                    f"as {invitation.role} by {inviter_name}.\n\n"
                )
                if dashboard_url:
                    from urllib.parse import urlparse
                    parsed = urlparse(dashboard_url)
                    base = f"{parsed.scheme}://{parsed.netloc}"
                    link = f"{base}/dashboard/accept?token={invitation.token}"
                    text += f"Click the link below to join:\n{link}"
                else:
                    text += "Open the dashboard to accept or decline this invitation."

                await bot.send_message(invited_user.tg_user_id, text)
            except Exception:
                logger.debug(
                    "Could not send Telegram DM to user %s", invited_user.tg_user_id, exc_info=True
                )

    def _serialize_invitation(
        self,
        invitation: WorkspaceInvitation,
        invited_user: User | None,
        inviter: User | None,
    ) -> dict[str, Any]:
        return {
            "id": invitation.id,
            "token": invitation.token,
            "invited_user_id": invitation.invited_user_id,
            "invited_username": invited_user.username if invited_user else None,
            "invited_full_name": invited_user.full_name if invited_user else None,
            "inviter_user_id": invitation.inviter_user_id,
            "inviter_username": inviter.username if inviter else None,
            "inviter_full_name": inviter.full_name if inviter else None,
            "role": invitation.role,
            "status": invitation.status,
            "created_at": invitation.created_at.isoformat() if invitation.created_at else None,
            "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
            "accepted_at": invitation.accepted_at.isoformat() if invitation.accepted_at else None,
            "declined_at": invitation.declined_at.isoformat() if invitation.declined_at else None,
            "revoked_at": invitation.revoked_at.isoformat() if invitation.revoked_at else None,
        }

    async def _resolve_identifier(
        self, identifier: str, *, telegram_client: Any | None = None
    ) -> User | None:
        cleaned = identifier.strip().lstrip("@")
        if not cleaned:
            return None

        kind = self._classify_identifier(cleaned)
        normalized = self._normalize_identifier(cleaned)

        if kind == "phone":
            digits_only = re.sub(r"\D", "", cleaned)
            e164 = f"+{digits_only}" if cleaned.startswith("+") else f"+{digits_only}"
            existing = (
                await self.session.execute(
                    select(User).where(User.phone_number == e164)
                )
            ).scalar_one_or_none()
            if existing is not None:
                return existing
        elif kind == "tg_id":
            existing = (
                await self.session.execute(select(User).where(User.tg_user_id == int(normalized)))
            ).scalar_one_or_none()
            if existing is not None:
                return existing
        else:
            existing = (
                await self.session.execute(
                    select(User).where(func.lower(User.username) == normalized.lower())
                )
            ).scalar_one_or_none()
            if existing is not None:
                return existing

        if telegram_client is None:
            return None

        return await self._resolve_via_telegram(telegram_client, normalized)

    async def _resolve_via_telegram(self, client: Any, identifier: str) -> User | None:
        entity = None
        try:
            entity = await client.get_entity(identifier)
        except Exception:
            if identifier.startswith("+"):
                entity = await self._resolve_phone_via_import(client, identifier)
            if entity is None:
                logger.debug("Telegram entity not found for %s", identifier, exc_info=True)
                return None

        tg_user_id = getattr(entity, "id", None)
        if tg_user_id is None:
            return None

        username = getattr(entity, "username", None)
        first_name = getattr(entity, "first_name", None)
        last_name = getattr(entity, "last_name", None)
        full_name = " ".join(filter(None, [first_name, last_name])) or None

        existing = (
            await self.session.execute(select(User).where(User.tg_user_id == tg_user_id))
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        user = User(
            tg_user_id=tg_user_id,
            username=username,
            full_name=full_name,
            language_code="en",
        )
        self.session.add(user)
        await self.session.flush()
        return user

    @staticmethod
    async def _resolve_phone_via_import(client: Any, phone: str) -> Any | None:
        from telethon.tl.functions.contacts import (
            DeleteContactsRequest,
            ImportContactsRequest,
        )
        from telethon.tl.types import InputPhoneContact

        result = await client(ImportContactsRequest(
            contacts=[InputPhoneContact(
                client_id=0,
                phone=phone,
                first_name=" ",
                last_name=" ",
            )]
        ))
        if not result.users:
            return None
        found = result.users[0]
        try:
            await client(DeleteContactsRequest(id=[found]))
        except Exception:
            pass
        return found

    @staticmethod
    def _classify_identifier(value: str) -> str:
        cleaned = value.strip().lstrip("@")
        if not cleaned:
            return "username"
        if cleaned.startswith("+") or (
            cleaned.isdigit() and len(cleaned) >= 8
        ):
            return "phone"
        if cleaned.isdigit():
            return "tg_id"
        return "username"

    @staticmethod
    def _normalize_identifier(value: str) -> str:
        cleaned = value.strip().lstrip("@")
        if not cleaned:
            return cleaned
        if cleaned.startswith("+") or (cleaned.isdigit() and len(cleaned) >= 8):
            digits = re.sub(r"\D", "", cleaned)
            return f"+{digits}"
        return cleaned
