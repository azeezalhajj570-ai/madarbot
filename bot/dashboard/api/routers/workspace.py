from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import Agent, Plan, Subscription, Tenant, TenantMembership
from bot.db.session import get_session
from bot.services.user_service import UserService
from bot.services.workspace_service import WorkspaceError, WorkspaceService

from ..dependencies import WorkspaceContext, get_identity, get_workspace_context
from .auth_boundary import require_any_boundary

logger = logging.getLogger(__name__)

router = APIRouter(tags=["workspace"])

WORKSPACE_BOUNDARY = Depends(require_any_boundary(["admin", "agents"]))


class CreateWorkspaceRequest(BaseModel):
    name: str


class CreateInvitationRequest(BaseModel):
    identifier: str
    role: str = "member"


class ChangeRoleRequest(BaseModel):
    role: str


async def _subscription_summary(session: AsyncSession, tenant_id: int) -> dict[str, Any] | None:
    row = (
        await session.execute(
            select(Subscription, Plan)
            .join(Plan, Plan.id == Subscription.plan_id, isouter=True)
            .where(Subscription.tenant_id == tenant_id, Subscription.status == "active")
        )
    ).first()
    if row is None:
        return None
    subscription, plan = row
    return {"plan": plan.slug if plan else None, "status": subscription.status}


async def _workspace_summary(
    session: AsyncSession, workspace_service: WorkspaceService, tenant: Tenant, role: str
) -> dict[str, Any]:
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "role": role,
        "member_count": await workspace_service.member_count(tenant.id),
        "subscription": await _subscription_summary(session, tenant.id),
    }


# ── workspace CRUD ─────────────────────────────────────────────


@router.get("/api/workspace", dependencies=[WORKSPACE_BOUNDARY])
@router.get("/webapp/workspace", dependencies=[WORKSPACE_BOUNDARY])
async def list_workspaces(
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    memberships = await workspace_service.list_user_memberships(user.id)
    if not memberships:
        tenant = await workspace_service.get_or_create_user_workspace(user.id)
        memberships = await workspace_service.list_user_memberships(user.id)

    summaries = []
    for membership in memberships:
        tenant = await session.get(Tenant, membership.tenant_id)
        if tenant is None:
            continue
        summaries.append(await _workspace_summary(session, workspace_service, tenant, membership.role))

    return {"workspaces": summaries}


@router.post("/api/workspace", dependencies=[WORKSPACE_BOUNDARY], status_code=status.HTTP_201_CREATED)
@router.post(
    "/webapp/workspace", dependencies=[WORKSPACE_BOUNDARY], status_code=status.HTTP_201_CREATED
)
async def create_workspace(
    payload: CreateWorkspaceRequest,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Workspace name is required"
        )

    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    tenant = Tenant(owner_user_id=user.id, name=name)
    session.add(tenant)
    await session.flush()
    session.add(TenantMembership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    await session.commit()

    workspace_service = WorkspaceService(session)
    return await _workspace_summary(session, workspace_service, tenant, "owner")


@router.get("/api/workspace/{workspace_id}/members", dependencies=[WORKSPACE_BOUNDARY])
@router.get("/webapp/workspace/{workspace_id}/members", dependencies=[WORKSPACE_BOUNDARY])
async def list_workspace_members(
    workspace_id: int,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    if await workspace_service.get_membership(tenant_id=workspace_id, user_id=user.id) is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")

    members = await workspace_service.list_members(workspace_id)
    return {"members": members}


@router.delete(
    "/api/workspace/{workspace_id}/members/{member_user_id}",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_204_NO_CONTENT,
)
@router.delete(
    "/webapp/workspace/{workspace_id}/members/{member_user_id}",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_workspace_member(
    workspace_id: int,
    member_user_id: int,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> None:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    try:
        await workspace_service.remove_member(
            tenant_id=workspace_id, actor_user_id=user.id, target_user_id=member_user_id
        )
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.patch(
    "/api/workspace/{workspace_id}/members/{member_user_id}/role", dependencies=[WORKSPACE_BOUNDARY]
)
@router.patch(
    "/webapp/workspace/{workspace_id}/members/{member_user_id}/role", dependencies=[WORKSPACE_BOUNDARY]
)
async def change_workspace_member_role(
    workspace_id: int,
    member_user_id: int,
    payload: ChangeRoleRequest,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    try:
        membership = await workspace_service.change_role(
            tenant_id=workspace_id,
            actor_user_id=user.id,
            target_user_id=member_user_id,
            new_role=payload.role,
        )
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"user_id": membership.user_id, "role": membership.role}


# ── invitations ────────────────────────────────────────────────


async def _get_workspace_telegram_client(
    session: AsyncSession, workspace_id: int, owner_tg_user_id: int | None = None,
) -> Any | None:
    from bot.config import get_settings

    settings = get_settings()
    if not settings.telegram_api_id or not settings.telegram_api_hash:
        return None

    agent = (
        await session.execute(
            select(Agent)
            .where(
                Agent.tenant_id == workspace_id,
                Agent.auth_state == "active",
                Agent.session_string.is_not(None),
            )
            .order_by(desc(Agent.updated_at))
            .limit(1)
        )
    ).scalar_one_or_none()

    if agent is None and owner_tg_user_id is not None:
        agent = (
            await session.execute(
                select(Agent)
                .where(
                    Agent.linked_by_user_id == owner_tg_user_id,
                    Agent.auth_state == "active",
                    Agent.session_string.is_not(None),
                )
                .order_by(desc(Agent.updated_at))
                .limit(1)
            )
        ).scalar_one_or_none()

    if agent is None:
        return None

    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        client = TelegramClient(
            StringSession(agent.session_string),
            settings.telegram_api_id,
            settings.telegram_api_hash,
        )
        await client.connect()
        return client
    except Exception:
        logger.debug("Could not create Telegram client for workspace %s", workspace_id, exc_info=True)
        return None


@router.post(
    "/api/workspace/{workspace_id}/invitations",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/webapp/workspace/{workspace_id}/invitations",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    workspace_id: int,
    payload: CreateInvitationRequest,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    workspace_service = WorkspaceService(session)

    telegram_client = await _get_workspace_telegram_client(
        session, workspace_id, owner_tg_user_id=ctx.identity.user_id,
    )
    try:
        invitation = await workspace_service.create_invitation(
            tenant_id=workspace_id,
            inviter_user_id=ctx.user.id,
            identifier=payload.identifier,
            role=payload.role,
            telegram_client=telegram_client,
        )
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    finally:
        if telegram_client is not None:
            try:
                await telegram_client.disconnect()
            except Exception:
                pass
    return {
        "id": invitation.id,
        "invited_user_id": invitation.invited_user_id,
        "role": invitation.role,
        "status": invitation.status,
        "token": invitation.token,
        "created_at": invitation.created_at.isoformat() if invitation.created_at else None,
        "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
    }


@router.get("/api/workspace/{workspace_id}/invitations", dependencies=[WORKSPACE_BOUNDARY])
@router.get("/webapp/workspace/{workspace_id}/invitations", dependencies=[WORKSPACE_BOUNDARY])
async def list_invitations(
    workspace_id: int,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    workspace_service = WorkspaceService(session)
    invitations = await workspace_service.list_invitations(workspace_id)
    return {"invitations": invitations}


@router.get("/api/workspace/invitations/pending")
@router.get("/webapp/workspace/invitations/pending")
async def list_pending_invitations(
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    invitations = await workspace_service.list_user_pending_invitations(user.id)
    return {"invitations": invitations}


@router.post("/api/workspace/invitations/{token}/accept")
@router.post("/webapp/workspace/invitations/{token}/accept")
async def accept_invitation(
    token: str,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    try:
        membership = await workspace_service.accept_invitation(token=token, user_id=user.id)
    except WorkspaceError as exc:
        exc_str = str(exc)
        if "not found" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc_str) from exc
        if "expired" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_410_GONE, detail=exc_str) from exc
        if "does not belong" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=exc_str) from exc
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc_str) from exc
    tenant = await session.get(Tenant, membership.tenant_id)
    return {
        "workspace_id": membership.tenant_id,
        "workspace_name": tenant.name if tenant else None,
        "role": membership.role,
        "status": "accepted",
    }


@router.post("/api/workspace/invitations/{token}/decline")
@router.post("/webapp/workspace/invitations/{token}/decline")
async def decline_invitation(
    token: str,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    try:
        await workspace_service.decline_invitation(token=token, user_id=user.id)
    except WorkspaceError as exc:
        exc_str = str(exc)
        if "not found" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc_str) from exc
        if "does not belong" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=exc_str) from exc
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc_str) from exc
    return {"status": "declined"}


@router.post(
    "/api/workspace/{workspace_id}/invitations/{token}/revoke",
    dependencies=[WORKSPACE_BOUNDARY],
)
@router.post(
    "/webapp/workspace/{workspace_id}/invitations/{token}/revoke",
    dependencies=[WORKSPACE_BOUNDARY],
)
async def revoke_invitation(
    workspace_id: int,
    token: str,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    workspace_service = WorkspaceService(session)
    try:
        invitation = await workspace_service.revoke_invitation(
            token=token, tenant_id=workspace_id, actor_user_id=ctx.user.id
        )
    except WorkspaceError as exc:
        exc_str = str(exc)
        if "not found" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc_str) from exc
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc_str) from exc
    return {
        "id": invitation.id,
        "status": invitation.status,
        "revoked_at": invitation.revoked_at.isoformat() if invitation.revoked_at else None,
    }


@router.post(
    "/api/workspace/{workspace_id}/invitations/{token}/resend",
    dependencies=[WORKSPACE_BOUNDARY],
)
@router.post(
    "/webapp/workspace/{workspace_id}/invitations/{token}/resend",
    dependencies=[WORKSPACE_BOUNDARY],
)
async def resend_invitation(
    workspace_id: int,
    token: str,
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    workspace_service = WorkspaceService(session)
    try:
        invitation = await workspace_service.resend_invitation(
            token=token, tenant_id=workspace_id, actor_user_id=ctx.user.id
        )
    except WorkspaceError as exc:
        exc_str = str(exc)
        if "not found" in exc_str.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc_str) from exc
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc_str) from exc
    return {
        "id": invitation.id,
        "status": invitation.status,
        "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
    }


__all__ = ["router"]
