"""Member search endpoints (dynamic filter builder API).

POST /api/agents/{agent_id}/member-search
POST /webapp/agents/{agent_id}/member-search

Both routes share the same handler, guarded by the agents/admin app-boundary
dependency (mirrors bot/dashboard/api/routers/agents.py). Structured errors
follow the spec: {"error": {"code", "message", "field"}}.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from bot.dashboard.api.auth import TelegramWebAppIdentity
from bot.dashboard.api.dependencies import ensure_agent_admin, get_identity, get_session
from bot.dashboard.api.routers._shared import MemberSearchRequest
from bot.search.exceptions import FilterValidationError
from bot.services.member_search_service import MemberSearchService

from .auth_boundary import require_any_boundary

router = APIRouter(tags=["members"])


@router.post(
    "/api/agents/{agent_id}/member-search",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.post(
    "/webapp/agents/{agent_id}/member-search",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_member_search(
    agent_id: int,
    payload: MemberSearchRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await MemberSearchService(session).search_members(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            group_ids=payload.group_ids,
            filter_data=payload.filter.model_dump() if payload.filter is not None else None,
            date_from=payload.date_from,
            date_to=payload.date_to,
            page=payload.page,
            page_size=payload.page_size,
            sort=payload.sort,
            include_total=payload.include_total,
        )
    except FilterValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": {
                    "code": exc.code,
                    "message": str(exc),
                    "field": exc.field,
                }
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "INVALID_REQUEST", "message": str(exc)}},
        ) from exc
