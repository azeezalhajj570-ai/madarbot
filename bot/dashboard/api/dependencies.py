from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from aiogram import Bot
from fastapi import Depends, Header, HTTPException, status
import sqlalchemy as sa
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.dashboard.api.auth import _DecodedJWT, extract_dashboard_identity
from bot.db.models import Agent, Group, GroupAdminRole, Tenant, User
from bot.db.session import get_session
from bot.services.group_service import canonical_tg_group_id, upsert_group
from bot.services.permission_service import PermissionService
from bot.services.subscription_service import SubscriptionService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity
from bot.services.user_service import UserService
from bot.services.workspace_service import WorkspaceService

PLAN_LIMIT_KEYS: dict[str, str] = {
    "groups": "max_groups",
    "scheduled_messages": "max_scheduled_messages",
    "automation_tasks": "max_automation_tasks",
}


def _resolve_bot_kind_from_header(x_app_boundary: str | None) -> str | None:
    boundary = (x_app_boundary or "").strip().lower()
    if boundary == "agents":
        return "agents"
    return None


async def check_plan_limit(
    session: AsyncSession,
    identity: TelegramWebAppIdentity,
    resource: str,
    current_count: int,
    bot_kind: str | None = None,
) -> None:
    settings = get_settings()
    if identity.user_id in settings.bot_owner_ids:
        return
    sub = await SubscriptionService(session).get_active_subscription(
        tg_user_id=identity.user_id, bot_kind=bot_kind
    )
    if sub is None or sub.plan != "free":
        return
    limit_key = PLAN_LIMIT_KEYS.get(resource)
    if limit_key is None:
        return
    limit = settings.FREE_PLAN_LIMITS.get(limit_key, 0)
    if current_count >= limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Free plan limit reached: max {limit} {resource}. Upgrade to Pro for unlimited.",
        )


async def _resolve_subscription_info(
    session: AsyncSession, identity: TelegramWebAppIdentity
) -> dict[str, Any] | None:
    sub = await SubscriptionService(session).get_active_subscription(tg_user_id=identity.user_id)
    if sub is None:
        return None
    return {
        "plan": sub.plan,
        "status": sub.status,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }


logger = logging.getLogger(__name__)


async def _bot_install_username() -> str:
    configured_username = str(get_settings().telegram_login_bot_username or "").strip()
    if configured_username:
        return configured_username

    bot = Bot(token=get_settings().bot_token)
    try:
        me = await bot.get_me()
        username = str(getattr(me, "username", "") or "").strip()
        if not username:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Bot username unavailable"
            )
        return username
    finally:
        await bot.session.close()


def build_bot_install_link(*, bot_username: str, permissions: list[str]) -> str:
    base = f"https://t.me/{quote(bot_username)}?startgroup=true"
    if not permissions:
        return base
    return f"{base}&admin={'+'.join(permissions)}"


async def list_identity_bot_install_groups(
    session: AsyncSession,
    *,
    identity: TelegramWebAppIdentity,
) -> list[dict[str, Any]]:
    managed_rows = (
        await session.execute(
            select(Group.id, Group.title, Group.tg_group_id, GroupAdminRole.role)
            .join(GroupAdminRole, GroupAdminRole.group_id == Group.id)
            .where(GroupAdminRole.user_id == identity.user_id, Group.is_active.is_(True))
            .order_by(Group.title.asc())
        )
    ).all()
    managed_by_tg_id = {
        int(row.tg_group_id): {
            "managed_group_id": int(row.id),
            "tg_group_id": int(row.tg_group_id),
            "title": row.title,
            "role": row.role,
            "is_managed": True,
        }
        for row in managed_rows
    }

    agent = (
        await session.execute(
            select(Agent)
            .where(
                Agent.telegram_user_id == identity.user_id,
                Agent.auth_state == "active",
                Agent.session_string.is_not(None),
            )
            .order_by(desc(Agent.updated_at), desc(Agent.id))
        )
    ).scalar_one_or_none()
    if agent is None:
        return list(managed_by_tg_id.values())

    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.utils import get_peer_id

    settings = get_settings()
    if not settings.telegram_api_id or not settings.telegram_api_hash:
        return list(managed_by_tg_id.values())

    client = TelegramClient(
        StringSession(agent.session_string),
        settings.telegram_api_id,
        settings.telegram_api_hash,
    )
    await client.connect()
    try:
        me = await client.get_me()
        candidates: dict[int, dict[str, Any]] = dict(managed_by_tg_id)
        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            if not (dialog.is_group or getattr(entity, "megagroup", False)):
                continue

            can_add_bot = bool(
                getattr(entity, "creator", False) or getattr(entity, "admin_rights", None)
            )
            if not can_add_bot:
                try:
                    permissions = await client.get_permissions(entity, me)
                except Exception:
                    permissions = None
                can_add_bot = bool(
                    getattr(permissions, "is_admin", False)
                    or getattr(permissions, "is_creator", False)
                )
            if not can_add_bot:
                continue

            tg_group_id = canonical_tg_group_id(int(get_peer_id(entity)))
            title = str(
                getattr(dialog, "title", None) or getattr(entity, "title", None) or tg_group_id
            )
            existing = candidates.get(tg_group_id, {})
            candidates[tg_group_id] = {
                "managed_group_id": existing.get("managed_group_id"),
                "tg_group_id": tg_group_id,
                "title": title,
                "role": existing.get("role") or "admin",
                "is_managed": bool(existing.get("is_managed")),
            }
        return sorted(candidates.values(), key=lambda item: str(item["title"]).lower())
    finally:
        await client.disconnect()


async def get_identity(
    decoded: _DecodedJWT = Depends(extract_dashboard_identity),
) -> TelegramWebAppIdentity:
    return decoded.identity


async def get_validated_identity(
    decoded: _DecodedJWT = Depends(extract_dashboard_identity),
    session: AsyncSession = Depends(get_session),
) -> TelegramWebAppIdentity:
    """Like get_identity but validates token_version against the DB.

    If the JWT's token_version doesn't match the user's current
    token_version, the token has been revoked (e.g. via logout) and
    we reject it with 401.
    """
    identity = decoded.identity
    if decoded.token_version > 0:
        user = (
            await session.execute(
                select(User).where(User.tg_user_id == identity.user_id)
            )
        ).scalar_one_or_none()
        if user is not None and user.token_version != decoded.token_version:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session revoked",
            )
    return identity


async def get_identity_optional(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
    init_data: str | None = None,
) -> TelegramWebAppIdentity | None:
    """Best-effort identity extraction that returns None instead of 401."""
    from bot.dashboard.api.auth import decode_dashboard_jwt, verify_telegram_init_data_identity, DashboardJWTError, TelegramWebAppAuthError

    if authorization:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if token:
            try:
                decoded = decode_dashboard_jwt(token)
                return decoded.identity
            except DashboardJWTError:
                return None

    value = x_telegram_init_data or init_data
    if value:
        try:
            return verify_telegram_init_data_identity(value)
        except TelegramWebAppAuthError:
            return None

    return None


@dataclass
class WorkspaceContext:
    """`identity` plus the resolved `users.id` row and active workspace (tenant).

    `identity.user_id` is the raw Telegram user id — most existing code reads
    that directly. This is the new, additive path for anything that needs
    `TenantMembership`-based access (which is keyed on `users.id`), without
    changing what `get_identity` returns for existing callers.
    """

    identity: TelegramWebAppIdentity
    user: User
    tenant_id: int
    role: str


async def get_workspace_context(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
    x_workspace_id: int | None = Header(default=None, alias="X-Workspace-Id"),
) -> WorkspaceContext:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)

    memberships = await workspace_service.list_user_memberships(user.id)
    if not memberships:
        tenant = await workspace_service.get_or_create_user_workspace(user.id)
        memberships = await workspace_service.list_user_memberships(user.id)
        tenant_id = tenant.id
        role = "owner"
    elif x_workspace_id is not None:
        selected = next((m for m in memberships if m.tenant_id == x_workspace_id), None)
        if selected is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a member of the requested workspace",
            )
        tenant_id = selected.tenant_id
        role = selected.role
    else:
        owned = next((m for m in memberships if m.role == "owner"), memberships[0])
        tenant_id = owned.tenant_id
        role = owned.role

    return WorkspaceContext(identity=identity, user=user, tenant_id=tenant_id, role=role)


async def require_active_subscription(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
    x_app_boundary: str | None = Header(default=None, alias="X-App-Boundary"),
) -> TelegramWebAppIdentity:
    settings = get_settings()
    if identity.user_id in settings.bot_owner_ids:
        return identity

    bot_kind = _resolve_bot_kind_from_header(x_app_boundary)
    if not await SubscriptionService(session).has_active_subscription(
        tg_user_id=identity.user_id, bot_kind=bot_kind
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active subscription required to access this feature",
        )
    return identity


async def require_active_workspace(
    workspace: WorkspaceContext = Depends(get_workspace_context),
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
) -> WorkspaceContext:
    """WorkspaceContext + active subscription check combined."""
    return workspace


async def require_business_plan(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
    x_app_boundary: str | None = Header(default=None, alias="X-App-Boundary"),
) -> TelegramWebAppIdentity:
    settings = get_settings()
    if identity.user_id in settings.bot_owner_ids:
        return identity

    bot_kind = _resolve_bot_kind_from_header(x_app_boundary)
    sub = await SubscriptionService(session).get_active_subscription(
        tg_user_id=identity.user_id, bot_kind=bot_kind
    )
    if not sub or sub.plan != "business":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Business plan required to access this feature",
        )
    return identity


async def require_bot_owner(
    identity: TelegramWebAppIdentity = Depends(get_identity),
) -> TelegramWebAppIdentity:
    if identity.user_id not in get_settings().bot_owner_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only bot owners can perform this action"
        )
    return identity


async def _sync_identity_admin_roles(
    session: AsyncSession,
    *,
    identity: TelegramWebAppIdentity,
) -> None:
    groups = (
        (
            await session.execute(
                select(Group).where(Group.is_active.is_(True)).order_by(Group.id.asc())
            )
        )
        .scalars()
        .all()
    )
    if not groups:
        return

    bot = Bot(token=get_settings().bot_token)
    changed = False
    try:
        for group in groups:
            try:
                member = await bot.get_chat_member(group.tg_group_id, identity.user_id)
            except Exception:
                continue

            status_name = getattr(member, "status", None)
            if status_name not in {"creator", "owner", "administrator"}:
                continue

            existing_role = (
                await session.execute(
                    select(GroupAdminRole).where(
                        GroupAdminRole.group_id == group.id,
                        GroupAdminRole.user_id == identity.user_id,
                    )
                )
            ).scalar_one_or_none()
            if existing_role is not None:
                continue

            session.add(
                GroupAdminRole(
                    group_id=group.id,
                    user_id=identity.user_id,
                    role="owner" if status_name in {"creator", "owner"} else "admin",
                )
            )
            changed = True

        if changed:
            await session.commit()
    finally:
        await bot.session.close()


async def _backfill_identity_groups_from_candidates(
    session: AsyncSession,
    *,
    identity: TelegramWebAppIdentity,
) -> None:
    candidates = await list_identity_bot_install_groups(session, identity=identity)
    changed = False
    for candidate in candidates:
        tg_group_id = int(candidate["tg_group_id"])
        title = str(candidate.get("title") or tg_group_id)
        role_name = str(candidate.get("role") or "admin")
        managed_group_id = candidate.get("managed_group_id")

        if managed_group_id:
            group = (
                await session.execute(select(Group).where(Group.id == int(managed_group_id)))
            ).scalar_one_or_none()
            if group is None:
                group = await upsert_group(
                    session, tg_group_id=tg_group_id, title=title, is_active=True
                )
                changed = True
            else:
                if group.title != title:
                    group.title = title
                    changed = True
                if not group.is_active:
                    group.is_active = True
                    changed = True
        else:
            group = await upsert_group(
                session, tg_group_id=tg_group_id, title=title, is_active=True
            )
            changed = True

        existing_role = (
            await session.execute(
                select(GroupAdminRole).where(
                    GroupAdminRole.group_id == group.id,
                    GroupAdminRole.user_id == identity.user_id,
                )
            )
        ).scalar_one_or_none()
        if existing_role is None:
            session.add(GroupAdminRole(group_id=group.id, user_id=identity.user_id, role=role_name))
            changed = True
        elif existing_role.role != role_name:
            existing_role.role = role_name
            changed = True

    if changed:
        await session.commit()


async def ensure_group_admin(
    group_id: int,
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
) -> None:
    if identity.user_id in get_settings().bot_owner_ids:
        return
    can_access = await PermissionService(session).user_level(group_id, identity.user_id)
    if can_access is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User is not a group administrator"
        )


async def ensure_group_admin_access(
    group_id: int,
    session: AsyncSession,
    identity: TelegramWebAppIdentity,
) -> None:
    if identity.user_id in get_settings().bot_owner_ids:
        return
    can_access = await PermissionService(session).user_level(group_id, identity.user_id)
    if can_access is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User is not a group administrator"
        )


async def ensure_agent_admin(
    agent_id: int,
    session: AsyncSession,
    identity: TelegramWebAppIdentity,
) -> Agent:
    agent = (await session.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")

    if agent.tenant_id is not None:
        user = await UserService(session).get_by_tg_id(identity.user_id)
        membership = (
            await WorkspaceService(session).get_membership(
                tenant_id=agent.tenant_id, user_id=user.id
            )
            if user is not None
            else None
        )
        if membership is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your agent")
        return agent

    # Agent predates the tenant_id backfill — fall back to the legacy check.
    if agent.linked_by_user_id is not None and agent.linked_by_user_id != identity.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your agent")
    return agent


async def build_identity_profile(
    session: AsyncSession,
    *,
    identity: TelegramWebAppIdentity,
) -> dict[str, Any]:
    settings = get_settings()
    user_service = UserService(session)
    language_code = await user_service.resolve_language(identity.user_id)
    user_row = await user_service.get_by_tg_id(identity.user_id)

    inactive_stmt = (
        sa.select(Group.id, Group.tg_group_id, Group.title)
        .join(GroupAdminRole, GroupAdminRole.group_id == Group.id)
        .where(
            GroupAdminRole.user_id == identity.user_id,
            Group.is_active.is_(False),
            sa.or_(
                Group.registered_by_user_id == identity.user_id,
                Group.registered_by_user_id.is_(None),
            ),
        )
    )
    inactive = (await session.execute(inactive_stmt)).all()
    if inactive:
        for row in inactive:
            group = (
                await session.execute(select(Group).where(Group.id == row.id))
            ).scalar_one_or_none()
            if group is not None:
                group.is_active = True
        await session.commit()

    groups_stmt = (
        select(Group.id, Group.title, Group.tg_group_id, GroupAdminRole.role, Group.created_at)
        .join(GroupAdminRole, GroupAdminRole.group_id == Group.id)
        .where(
            GroupAdminRole.user_id == identity.user_id,
            Group.is_active.is_(True),
            sa.or_(
                Group.registered_by_user_id == identity.user_id,
                Group.registered_by_user_id.is_(None),
            ),
        )
        .order_by(Group.created_at.desc())
    )
    groups = (await session.execute(groups_stmt)).all()
    if not groups:
        await _sync_identity_admin_roles(session, identity=identity)
        groups = (await session.execute(groups_stmt)).all()
    if not groups:
        await _backfill_identity_groups_from_candidates(session, identity=identity)
        groups = (await session.execute(groups_stmt)).all()

    if not groups and identity.user_id in settings.bot_owner_ids:
        all_groups_stmt = select(
            Group.id, Group.title, Group.tg_group_id, sa.literal("owner").label("role")
        ).order_by(Group.created_at.desc())
        groups = (await session.execute(all_groups_stmt)).all()

    workspace_info = None
    workspaces_list = []
    if user_row is not None:
        workspace_service = WorkspaceService(session)
        memberships = await workspace_service.list_user_memberships(user_row.id)
        if memberships:
            for membership in memberships:
                tenant = await session.get(Tenant, membership.tenant_id)
                if tenant is None:
                    continue
                ws_summary = {
                    "id": str(tenant.id),
                    "name": tenant.name,
                    "role": membership.role,
                    "member_count": await workspace_service.member_count(tenant.id),
                }
                workspaces_list.append(ws_summary)
            owned = next((m for m in memberships if m.role == "owner"), memberships[0])
            active_tenant = await session.get(Tenant, owned.tenant_id)
            if active_tenant is not None:
                workspace_info = {
                    "id": str(active_tenant.id),
                    "name": active_tenant.name,
                    "role": owned.role,
                    "member_count": await workspace_service.member_count(active_tenant.id),
                }

    return {
        "user": {
            "id": identity.user_id,
            "username": identity.username,
            "first_name": identity.first_name,
            "last_name": identity.last_name,
            "language_code": language_code,
            "full_name": user_row.full_name if user_row else None,
            "phone_number": user_row.phone_number if user_row else None,
            "has_password": bool(user_row and user_row.password_hash),
        },
        "is_bot_owner": identity.user_id in settings.bot_owner_ids,
        "subscription": await _resolve_subscription_info(session, identity),
        "plan_limits": settings.FREE_PLAN_LIMITS,
        "groups": [
            {"id": row.id, "title": row.title, "tg_group_id": row.tg_group_id, "role": row.role}
            for row in groups
        ],
        "workspace": workspace_info,
        "workspaces": workspaces_list,
    }
