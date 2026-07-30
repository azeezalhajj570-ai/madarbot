from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import Tenant, TenantMembership, User

VALID_ROLES = {"owner", "admin", "member", "viewer"}
ROLES_THAT_CAN_INVITE = {"owner", "admin"}
ROLES_THAT_CAN_MANAGE_MEMBERS = {"owner", "admin"}


class WorkspaceError(ValueError):
    pass


class WorkspaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_user_workspace(self, user_id: int) -> Tenant:
        """Return the user's owned tenant, auto-creating a single-member one if missing.

        `user_id` is a `users.id` PK — resolve tg_user_id via
        `UserService.get_or_create_user_by_tg_id` first.
        """
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

    async def invite_member(
        self,
        *,
        tenant_id: int,
        inviter_user_id: int,
        identifier: str,
        role: str = "member",
    ) -> TenantMembership:
        if role not in VALID_ROLES:
            raise WorkspaceError(f"Invalid role: {role}")

        inviter_membership = await self.get_membership(tenant_id=tenant_id, user_id=inviter_user_id)
        if inviter_membership is None or inviter_membership.role not in ROLES_THAT_CAN_INVITE:
            raise WorkspaceError("Only workspace owners and admins can invite members")

        target_user = await self._resolve_identifier(identifier)
        if target_user is None:
            raise WorkspaceError(f"No user found for identifier: {identifier}")

        existing = await self.get_membership(tenant_id=tenant_id, user_id=target_user.id)
        if existing is not None:
            raise WorkspaceError("User is already a member of this workspace")

        membership = TenantMembership(tenant_id=tenant_id, user_id=target_user.id, role=role)
        self.session.add(membership)
        await self.session.commit()
        return membership

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

    async def _resolve_identifier(self, identifier: str) -> User | None:
        cleaned = identifier.strip().lstrip("@")
        if not cleaned:
            return None
        if cleaned.isdigit():
            return (
                await self.session.execute(select(User).where(User.tg_user_id == int(cleaned)))
            ).scalar_one_or_none()
        return (
            await self.session.execute(select(User).where(func.lower(User.username) == cleaned.lower()))
        ).scalar_one_or_none()
