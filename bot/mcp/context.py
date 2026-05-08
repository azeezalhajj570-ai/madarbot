from __future__ import annotations

import contextvars
from dataclasses import dataclass

from bot.config import get_settings

_mcp_actor_user_id: contextvars.ContextVar[int | None] = contextvars.ContextVar("mcp_actor_user_id", default=None)


@dataclass
class McpContext:
    actor_user_id: int
    readonly: bool


def set_mcp_actor_user_id(user_id: int) -> None:
    _mcp_actor_user_id.set(user_id)


def resolve_mcp_context() -> McpContext:
    settings = get_settings()
    actor_user_id = _mcp_actor_user_id.get(None)
    if actor_user_id is None:
        actor_user_id = settings.mcp_default_actor_user_id
    if actor_user_id is None:
        raise RuntimeError("MCP_DEFAULT_ACTOR_USER_ID is not set and no token-provided user ID")
    return McpContext(
        actor_user_id=int(actor_user_id),
        readonly=settings.mcp_readonly,
    )
