"""Telethon membership helpers for adding users to groups."""

from __future__ import annotations

from typing import Final

from pydantic import BaseModel, ConfigDict
import structlog

from telethon import TelegramClient
from telethon.errors import (
    ChatAdminRequiredError,
    ChatWriteForbiddenError,
    FloodWaitError,
    PeerIdInvalidError,
    RPCError,
    UserAlreadyParticipantError,
    UserNotParticipantError,
    UserPrivacyRestrictedError,
)
from telethon.tl.functions.channels import GetParticipantRequest, InviteToChannelRequest
from telethon.tl.functions.messages import (
    AddChatUserRequest,
    ExportChatInviteRequest,
    GetDialogsRequest,
    GetFullChatRequest,
)
from telethon.tl.types import Channel, InputPeerEmpty, InputUser, User


ERROR_USER_ALREADY_IN_GROUP: Final = "USER_ALREADY_IN_GROUP"
ERROR_USERBOT_NOT_IN_GROUP: Final = "USERBOT_NOT_IN_GROUP"
ERROR_USER_PRIVACY_RESTRICTED: Final = "USER_PRIVACY_RESTRICTED"
ERROR_INVITE_LINK_DM_FAILED: Final = "INVITE_LINK_DM_FAILED"
ERROR_FLOOD_WAIT: Final = "FLOOD_WAIT"
ERROR_PEER_NOT_FOUND: Final = "PEER_NOT_FOUND"
ERROR_IS_BOT: Final = "IS_BOT"
ERROR_VERIFICATION_FAILED: Final = "VERIFICATION_FAILED"
ERROR_UNKNOWN: Final = "UNKNOWN"
ERROR_NOT_ADMIN: Final = "NOT_ADMIN"

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


async def _resolve_group_from_dialogs(
    client: TelegramClient, group_id: int
) -> object | None:
    peer_channel_id = int(group_id)
    if peer_channel_id < 0:
        peer_channel_id = -peer_channel_id
    if str(peer_channel_id).startswith("100"):
        peer_channel_id = int(str(peer_channel_id)[3:])
    try:
        result = await client(GetDialogsRequest(
            offset_date=None, offset_id=0,
            offset_peer=InputPeerEmpty(),
            limit=500, hash=0,
        ))
        for chat in result.chats:
            if chat.id == peer_channel_id:
                return chat
    except Exception:
        pass
    return None


def _user_id_of(peer: object) -> int | None:
    if isinstance(peer, InputUser):
        return peer.user_id
    if isinstance(peer, User):
        return peer.id
    return getattr(peer, "id", None) or getattr(peer, "user_id", None)


async def is_user_in_group(
    client: TelegramClient,
    group_entity: object,
    user_peer: object,
) -> bool | None:
    """Verify that a user is actually a participant of a group.

    Returns ``True`` when the user is confirmed as a participant, ``False`` when
    they are confirmed absent, and ``None`` when membership could not be
    determined (e.g. a transient RPC error).
    """
    try:
        if isinstance(group_entity, Channel) or bool(getattr(group_entity, "megagroup", False)):
            await client(GetParticipantRequest(channel=group_entity, participant=user_peer))
            return True
        result = await client(GetFullChatRequest(chat_id=int(getattr(group_entity, "id", 0))))
        full_chat = getattr(result, "full_chat", None)
        participants = getattr(full_chat, "participants", None)
        entries = getattr(participants, "participants", None)
        if entries is None:
            return None
        target_id = _user_id_of(user_peer)
        if target_id is None:
            return None
        return any(getattr(entry, "user_id", None) == target_id for entry in entries)
    except UserNotParticipantError:
        return False
    except (PeerIdInvalidError, ValueError, KeyError, RPCError):
        return None


async def add_user_to_group(
    client: TelegramClient,
    group_id: int,
    user_id: int,
    access_hash: int | None = None,
    *,
    verify: bool = True,
) -> AddUserResult:
    bound_logger = logger.bind(
        group_id=group_id,
        user_id=user_id,
        error_code=None,
        flood_wait_seconds=None,
    )

    user_peer = None
    try:
        if access_hash is not None:
            user_peer = InputUser(user_id, access_hash)
        else:
            user_peer = await client.get_entity(user_id)
    except ValueError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)
    except PeerIdInvalidError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)
    except KeyError:
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)

    if getattr(user_peer, "bot", False):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_IS_BOT)

    try:
        group_entity = await client.get_entity(group_id)
    except ValueError:
        group_entity = await _resolve_group_from_dialogs(client, group_id)
        if group_entity is None:
            return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_PEER_NOT_FOUND)
    except (ChatAdminRequiredError, UserNotParticipantError):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_USERBOT_NOT_IN_GROUP)
    except FloodWaitError as exc:
        return _failure(
            group_id=group_id,
            user_id=user_id,
            error_code=ERROR_FLOOD_WAIT,
            flood_wait_seconds=int(exc.seconds),
        )
    except (ChatAdminRequiredError, UserNotParticipantError):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_USERBOT_NOT_IN_GROUP)
    except RPCError as exc:
        logger.bind(group_id=group_id, user_id=user_id, rpc_error=str(exc)).warning("agent_add_user_to_group_rpc_error")
        if "admin" in str(exc).lower():
            return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_NOT_ADMIN)
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_UNKNOWN)

    try:
        if isinstance(group_entity, Channel) or bool(getattr(group_entity, "megagroup", False)):
            invite_result = await client(
                InviteToChannelRequest(channel=group_id, users=[user_peer])
            )
            missing_invitees = getattr(invite_result, "missing_invitees", None) or []
            if any(_user_id_of(entry) == user_id for entry in missing_invitees):
                return _failure(
                    group_id=group_id,
                    user_id=user_id,
                    error_code=ERROR_USER_PRIVACY_RESTRICTED,
                )
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
    except (ChatAdminRequiredError, ChatWriteForbiddenError, UserNotParticipantError):
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_NOT_ADMIN)
    except RPCError as exc:
        logger.bind(group_id=group_id, user_id=user_id, rpc_error=str(exc)).warning("agent_invite_to_channel_rpc_error")
        if "admin" in str(exc).lower() or "forbidden" in str(exc).lower():
            return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_NOT_ADMIN)
        return _failure(group_id=group_id, user_id=user_id, error_code=ERROR_UNKNOWN)

    if verify:
        present = await is_user_in_group(client, group_entity, user_peer)
        if present is False:
            logger.bind(
                group_id=group_id,
                user_id=user_id,
                membership_verified=present,
            ).warning("agent_add_user_to_group_verification_failed")
            return _failure(
                group_id=group_id, user_id=user_id, error_code=ERROR_VERIFICATION_FAILED
            )
        if present is None:
            logger.bind(
                group_id=group_id,
                user_id=user_id,
                membership_verified=present,
            ).info("agent_add_user_to_group_verification_uncertain")

    bound_logger.info("agent_add_user_to_group_succeeded")
    return AddUserResult(success=True)


async def export_group_invite_link(client: TelegramClient, group_id: int) -> str | None:
    try:
        try:
            entity = await client.get_entity(group_id)
        except (ValueError, KeyError):
            entity = await _resolve_group_from_dialogs(client, group_id)
            if entity is None:
                logger.bind(group_id=group_id).warning("agent_group_invite_entity_not_found")
                return None
        result = await client(ExportChatInviteRequest(peer=entity))
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
    except (ChatAdminRequiredError, ChatWriteForbiddenError, RPCError) as exc:
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
