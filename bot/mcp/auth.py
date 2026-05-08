from __future__ import annotations

import hashlib
import logging

from bot.config import get_settings

logger = logging.getLogger(__name__)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_mcp_auth(token: str | None) -> tuple[bool, int | None]:
    settings = get_settings()
    if not settings.mcp_auth_token:
        return True, None
    if bool(token) and token == settings.mcp_auth_token:
        return True, None
    return False, None


async def verify_mcp_auth_async(token: str | None) -> tuple[bool, int | None]:
    if not token:
        return False, None

    ok, tg_user_id = verify_mcp_auth(token)
    if ok:
        return True, tg_user_id

    try:
        from bot.db.session import SessionLocal
        from bot.db.models.mcp_token import MCPToken
        from datetime import datetime, timezone
        from sqlalchemy import select

        async with SessionLocal() as session:
            token_hash = _hash_token(token)
            stmt = select(MCPToken).where(
                MCPToken.token_hash == token_hash,
                MCPToken.is_active == True,
            )
            result = await session.execute(stmt)
            record = result.scalar_one_or_none()
            if record is None:
                logger.warning("MCP auth: no matching token for hash=%s", token_hash[:16])
                return False, None
            now = datetime.now(timezone.utc)
            if record.expires_at and record.expires_at < now:
                logger.warning("MCP auth: token expired id=%s", record.id)
                return False, None
            logger.info("MCP auth: token verified id=%s name=%s tg_user_id=%s", record.id, record.name, record.tg_user_id)
            return True, int(record.tg_user_id)
    except Exception as exc:
        logger.error("MCP auth error: %s", exc)
        return False, None
