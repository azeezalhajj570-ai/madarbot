from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from bot.db.base import Base
from bot.db.models.mcp_token import MCPToken
from bot.db.session import engine


def _ensure_table(eng: AsyncEngine) -> None:
    import asyncio

    async def create():
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all, tables=[MCPToken.__table__])

    try:
        asyncio.get_running_loop().create_task(create())
    except RuntimeError:
        asyncio.run(create())


TOKEN_BYTES = 32


def _generate_token() -> tuple[str, str, str]:
    raw = secrets.token_hex(TOKEN_BYTES)
    token = f"mcp_{raw}"
    prefix = token[:12]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return token, prefix, token_hash


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class MCPTokenService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        _ensure_table(engine)

    async def create_token(
        self,
        *,
        tg_user_id: int,
        name: str,
        expires_at: datetime | None = None,
    ) -> tuple[str, MCPToken]:
        token, prefix, token_hash = _generate_token()
        record = MCPToken(
            tg_user_id=tg_user_id,
            name=name.strip()[:128],
            token_hash=token_hash,
            token_prefix=prefix,
            expires_at=expires_at,
        )
        self.session.add(record)
        await self.session.commit()
        await self.session.refresh(record)
        return token, record

    async def list_tokens(self, tg_user_id: int) -> list[MCPToken]:
        stmt = (
            select(MCPToken)
            .where(MCPToken.tg_user_id == tg_user_id)
            .order_by(MCPToken.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def revoke_token(self, token_id: int, tg_user_id: int) -> MCPToken | None:
        stmt = select(MCPToken).where(
            MCPToken.id == token_id,
            MCPToken.tg_user_id == tg_user_id,
        )
        record = (await self.session.execute(stmt)).scalar_one_or_none()
        if record is None:
            return None
        record.is_active = False
        record.revoked_at = datetime.now(timezone.utc)
        await self.session.commit()
        return record

    async def get_token_by_value(self, token: str) -> MCPToken | None:
        token_hash = _hash_token(token)
        stmt = select(MCPToken).where(
            MCPToken.token_hash == token_hash,
            MCPToken.is_active,
        )
        record = (await self.session.execute(stmt)).scalar_one_or_none()
        if record is None:
            return None
        now = datetime.now(timezone.utc)
        if record.expires_at and record.expires_at < now:
            return None
        return record

    @staticmethod
    def token_status(record: MCPToken) -> str:
        if not record.is_active:
            return "revoked"
        if record.expires_at and record.expires_at < datetime.now(timezone.utc):
            return "expired"
        return "active"

    @staticmethod
    def serialize(record: MCPToken) -> dict:
        return {
            "id": record.id,
            "name": record.name,
            "prefix": record.token_prefix,
            "status": MCPTokenService.token_status(record),
            "expires_at": record.expires_at.isoformat() if record.expires_at else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "revoked_at": record.revoked_at.isoformat() if record.revoked_at else None,
        }
