"""Telethon membership helpers for adding users to groups."""

from __future__ import annotations

from typing import Final

from pydantic import BaseModel, ConfigDict
import structlog

from telethon import TelegramClient
from telethon.errors import (
    ChatAdminRequiredError,
    FloodWaitError,
    PeerIdInvalidError,
    RPCError,
    UserAlreadyParticipantError,
    UserNotParticipantError,
    UserPrivacyRestrictedError,
)
from telethon.tl.functions.channels import InviteToChannelRequest
from telethon.tl.functions.messages import AddChatUserRequest, ExportChatInviteRequest
from telethon.tl.types import Channel


ERROR_USER_ALREADY_IN_GROUP: Final = "USER_ALREADY_IN_GROUP"
ERROR_USERBOT_NOT_IN_GROUP: Final = "USERBOT_NOT_IN_GROUP"
ERROR_USER_PRIVACY_RESTRICTED: Final = "USER_PRIVACY_RESTRICTED"
ERROR_INVITE_LINK_DM_FAILED: Final = "INVITE_LINK_DM_FAILED"
ERROR_FLOOD_WAIT: Final = "FLOOD_WAIT"
ERROR_PEER_NOT_FOUND: Final = "PEER_NOT_FOUND"
ERROR_UNKNOWN: Final = "UNKNOWN"

logger = structlog.get_logger(__name__)


class AddUserResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    success: bool
    error_code: str | None = None
    flood_wait_seconds: int | None = None


def _failure(
    *,
    group_id: int,
    user_id: int,
    error_code: str,
    flood_wait_seconds: int | None = None,
) -> AddUserResult:
    logger.bind(
        group_id=group_id,
        user_id=user_id,
        error_code=error_code,
        flood_wait_seconds=flood_wait_seconds,
    ).warning("agent_add_user_to_group_failed")
    return AddUserResult(
        success=False,
        error_code=error_code,
        flood_wait_seconds=flood_wait_seconds,
    )


async def add_user_to_group(
    client: TelegramClient,
    group_id: int,
    user_id: int,
) -> AddUserResult:
    bound_logger = logger.bind(
        group_id=group_id,
        user_id=user_id,
        error_code=None,
        flood_wait_seconds=None,
    )

    user_peer = None
    try:
        user_peer = await client.get_entity(user_id)
    except ValueError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)
    except PeerIdInvalidError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)

    try:
        group_entity = await client.get_entity(group_id)
    except (ChatAdminRequiredError, UserNotParticipantError):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_USERBOT_NOT_IN_GROUP)
    except FloodWaitError as exc:
        return _failure(
            group_id=group_id,
            user_id=user_id,
            error_code=ERROR_FLOOD_WAIT,
            flood_wait_seconds=int(exc.seconds),
        )
    except RPCError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_UNKNOWN)

    try:
        if isinstance(group_entity, Channel) or bool(getattr(group_entity, "megagroup", False)):
            await client(InviteToChannelRequest(channel=group_id, users=[user_peer]))
        else:
            legacy_chat_id = int(getattr(group_entity, "id"))
            await client(AddChatUserRequest(chat_id=legacy_chat_id, user_id=user_peer, fwd_limit=0))
    except UserAlreadyParticipantError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_USER_ALREADY_IN_GROUP)
    except UserPrivacyRestrictedError:
        return _failure(
            group_id=group_id, user_id=user_id, error_code=ERROR_USER_PRIVACY_RESTRICTED
        )
    except FloodWaitError as exc:
        return _failure(
            group_id=group_id,
            user_id=user_id,
            error_code=ERROR_FLOOD_WAIT,
            flood_wait_seconds=int(exc.seconds),
        )
    except (ChatAdminRequiredError, UserNotParticipantError):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_USERBOT_NOT_IN_GROUP)
    except RPCError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_UNKNOWN)

    bound_logger.info("agent_add_user_to_group_succeeded")
    return AddUserResult(success=True)


async def export_group_invite_link(client: TelegramClient, group_id: int) -> str | None:
    try:
        result = await client(ExportChatInviteRequest(peer=group_id))
        link = getattr(result, "link", None)
        if link:
            logger.bind(group_id=group_id).info("agent_group_invite_link_exported")
            return str(link)
        logger.bind(group_id=group_id).warning("agent_group_invite_link_missing")
        return None
    except FloodWaitError as exc:
        logger.bind(group_id=group_id, flood_wait=exc.seconds).warning(
            "agent_group_invite_link_flood_wait"
        )
        return None
    except (ChatAdminRequiredError, RPCError) as exc:
        logger.bind(group_id=group_id, error=str(exc)).warning(
            "agent_group_invite_link_export_failed"
        )
        return None


async def send_invite_link_to_user(
    client: TelegramClient, user_id: int, invite_link: str
) -> bool:
    try:
        await client.send_message(user_id, f"Join our group here: {invite_link}")
        return True
    except Exception:
        logger.bind(user_id=user_id).warning("agent_invite_link_dm_failed")
        return False
