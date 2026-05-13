from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.session import get_session
from bot.services.mcp_token_service import MCPTokenService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity

from ..dependencies import get_identity
from .auth_boundary import require_agents_boundary

router = APIRouter(tags=["mcp_tokens"])


class CreateTokenRequest(BaseModel):
    name: str
    expires_in_days: int | None = None


@router.post("/api/mcp/tokens", dependencies=[Depends(require_agents_boundary)])
async def create_mcp_token(
    payload: CreateTokenRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Token name is required"
        )
    if len(name) > 128:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Token name too long (max 128)"
        )

    expires_at: datetime | None = None
    if payload.expires_in_days:
        expires_at = datetime.now(timezone.utc).replace(microsecond=0) + __import__(
            "datetime"
        ).timedelta(days=payload.expires_in_days)

    token, record = await MCPTokenService(session).create_token(
        tg_user_id=identity.user_id,
        name=name,
        expires_at=expires_at,
    )

    return {
        "token": token,
        "token_data": MCPTokenService.serialize(record),
    }


@router.get("/api/mcp/tokens", dependencies=[Depends(require_agents_boundary)])
async def list_mcp_tokens(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    records = await MCPTokenService(session).list_tokens(tg_user_id=identity.user_id)
    return [MCPTokenService.serialize(r) for r in records]


@router.delete("/api/mcp/tokens/{token_id}", dependencies=[Depends(require_agents_boundary)])
async def revoke_mcp_token(
    token_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    record = await MCPTokenService(session).revoke_token(
        token_id=token_id, tg_user_id=identity.user_id
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    return {"status": "ok", "token_data": MCPTokenService.serialize(record)}


__all__ = ["router"]
