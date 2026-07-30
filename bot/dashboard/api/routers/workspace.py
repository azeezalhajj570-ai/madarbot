from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import Plan, Subscription, Tenant, TenantMembership
from bot.db.session import get_session
from bot.services.user_service import UserService
from bot.services.workspace_service import WorkspaceError, WorkspaceService

from ..dependencies import get_identity
from .auth_boundary import require_any_boundary

router = APIRouter(tags=["workspace"])

WORKSPACE_BOUNDARY = Depends(require_any_boundary(["admin", "agents"]))


class CreateWorkspaceRequest(BaseModel):
    name: str


class InviteMemberRequest(BaseModel):
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


@router.post(
    "/api/workspace/{workspace_id}/invite",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/webapp/workspace/{workspace_id}/invite",
    dependencies=[WORKSPACE_BOUNDARY],
    status_code=status.HTTP_201_CREATED,
)
async def invite_workspace_member(
    workspace_id: int,
    payload: InviteMemberRequest,
    identity=Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user = await UserService(session).get_or_create_user_by_tg_id(identity.user_id)
    workspace_service = WorkspaceService(session)
    try:
        membership = await workspace_service.invite_member(
            tenant_id=workspace_id,
            inviter_user_id=user.id,
            identifier=payload.identifier,
            role=payload.role,
        )
    except WorkspaceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"user_id": membership.user_id, "role": membership.role}


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


__all__ = ["router"]
