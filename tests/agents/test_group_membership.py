from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telethon.errors import (
    FloodWaitError,
    RPCError,
    UserAlreadyParticipantError,
    UserNotParticipantError,
    UserPrivacyRestrictedError,
)
from telethon.tl.functions.channels import GetParticipantRequest, InviteToChannelRequest
from telethon.tl.functions.messages import AddChatUserRequest
from telethon.tl.types import Channel, Chat, ChatPhotoEmpty, MissingInvitee, User

from bot.agents.group_membership import (
    ERROR_FLOOD_WAIT,
    ERROR_PEER_NOT_FOUND,
    ERROR_UNKNOWN,
    ERROR_USER_ALREADY_IN_GROUP,
    ERROR_USER_PRIVACY_RESTRICTED,
    ERROR_VERIFICATION_FAILED,
    add_user_to_group,
)


def _build_user(user_id: int) -> User:
    return User(
        id=user_id,
        is_self=False,
        contact=False,
        mutual_contact=False,
        deleted=False,
        bot=False,
        bot_chat_history=False,
        bot_nochats=False,
        verified=False,
        restricted=False,
        min=False,
        bot_inline_geo=False,
        support=False,
        scam=False,
        apply_min_photo=False,
        fake=False,
        bot_attach_menu=False,
        premium=False,
        attach_menu_enabled=False,
        bot_can_edit=False,
        close_friend=False,
        stories_hidden=False,
        stories_unavailable=False,
        contact_require_premium=False,
        bot_business=False,
        bot_has_main_app=False,
        access_hash=1,
        first_name="Target",
    )


def _build_channel(channel_id: int) -> Channel:
    return Channel(
        id=channel_id,
        title="Supergroup",
        photo=ChatPhotoEmpty(),
        date=datetime.now(UTC),
        megagroup=True,
    )


def _build_legacy_chat(chat_id: int) -> Chat:
    return Chat(
        id=chat_id,
        title="Legacy Group",
        photo=ChatPhotoEmpty(),
        participants_count=1,
        date=datetime.now(UTC),
        version=1,
    )


def _build_full_chat_response(user_ids: list[int]) -> SimpleNamespace:
    participants = [SimpleNamespace(user_id=uid) for uid in user_ids]
    full_chat = SimpleNamespace(participants=SimpleNamespace(participants=participants))
    return SimpleNamespace(full_chat=full_chat)


def _build_invited_users_response(missing_user_ids: list[int]) -> SimpleNamespace:
    missing_invitees = [
        MissingInvitee(user_id=uid, premium_would_allow_invite=False, premium_required_for_pm=False)
        for uid in missing_user_ids
    ]
    return SimpleNamespace(missing_invitees=missing_invitees)


@pytest.mark.asyncio
async def test_add_user_to_group_returns_privacy_restricted_when_missing_invitees() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.return_value = _build_invited_users_response([77])

    result = await add_user_to_group(client, -1001001, 77)

    assert result.success is False
    assert result.error_code == ERROR_USER_PRIVACY_RESTRICTED


@pytest.mark.asyncio
async def test_add_user_to_group_returns_privacy_restricted_when_other_missing() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.return_value = _build_invited_users_response([999, 77])

    result = await add_user_to_group(client, -1001001, 77)

    assert result.success is False
    assert result.error_code == ERROR_USER_PRIVACY_RESTRICTED


@pytest.mark.asyncio
async def test_add_user_to_group_succeeds_when_missing_invitees_not_for_target() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.return_value = _build_invited_users_response([999])

    result = await add_user_to_group(client, -1001001, 77)

    assert result.success is True
    assert isinstance(client.call_args_list[0].args[0], InviteToChannelRequest)
    assert isinstance(client.call_args_list[1].args[0], GetParticipantRequest)


@pytest.mark.asyncio
async def test_add_user_to_group_succeeds_for_supergroup() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.return_value = None

    result = await add_user_to_group(client, -1001001, 77)

    assert result.success is True
    assert isinstance(client.call_args_list[0].args[0], InviteToChannelRequest)
    assert isinstance(client.call_args_list[1].args[0], GetParticipantRequest)


@pytest.mark.asyncio
async def test_add_user_to_group_succeeds_for_legacy_group() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(78), _build_legacy_chat(222)])
    client.return_value = _build_full_chat_response([78])

    result = await add_user_to_group(client, -222, 78)

    assert result.success is True
    assert isinstance(client.call_args_list[0].args[0], AddChatUserRequest)


@pytest.mark.asyncio
async def test_add_user_to_group_returns_verification_failed_when_not_member() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.side_effect = [None, UserNotParticipantError(request=None)]

    result = await add_user_to_group(client, -1001001, 77)

    assert result.success is False
    assert result.error_code == ERROR_VERIFICATION_FAILED


@pytest.mark.asyncio
async def test_add_user_to_group_skips_verification_when_verify_false() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(77), _build_channel(1001)])
    client.return_value = None

    result = await add_user_to_group(client, -1001001, 77, verify=False)

    assert result.success is True
    assert len(client.call_args_list) == 1
    assert isinstance(client.call_args_list[0].args[0], InviteToChannelRequest)


@pytest.mark.asyncio
async def test_add_user_to_group_returns_already_in_group() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(79), _build_channel(1002)])
    client.side_effect = UserAlreadyParticipantError(request=None)

    result = await add_user_to_group(client, -1001002, 79)

    assert result.success is False
    assert result.error_code == ERROR_USER_ALREADY_IN_GROUP


@pytest.mark.asyncio
async def test_add_user_to_group_returns_privacy_restricted() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(80), _build_channel(1003)])
    client.side_effect = UserPrivacyRestrictedError(request=None)

    result = await add_user_to_group(client, -1001003, 80)

    assert result.success is False
    assert result.error_code == ERROR_USER_PRIVACY_RESTRICTED


@pytest.mark.asyncio
async def test_add_user_to_group_returns_flood_wait() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(81), _build_channel(1004)])
    client.side_effect = FloodWaitError(request=None, capture=42)

    result = await add_user_to_group(client, -1001004, 81)

    assert result.success is False
    assert result.error_code == ERROR_FLOOD_WAIT
    assert result.flood_wait_seconds == 42


@pytest.mark.asyncio
async def test_add_user_to_group_returns_peer_not_found() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=ValueError("unknown peer"))

    result = await add_user_to_group(client, -1001005, 82)

    assert result.success is False
    assert result.error_code == ERROR_PEER_NOT_FOUND


@pytest.mark.asyncio
async def test_add_user_to_group_returns_unknown_on_generic_telegram_error() -> None:
    client = AsyncMock()
    client.get_entity = AsyncMock(side_effect=[_build_user(83), _build_channel(1006)])
    client.side_effect = RPCError(request=None, message="boom")

    result = await add_user_to_group(client, -1001006, 83)

    assert result.success is False
    assert result.error_code == ERROR_UNKNOWN


# ─── Stale access_hash retry ──────────────────────────────────────────────────


def _invalid_user_id_error() -> RPCError:
    return RPCError(
        request=None,
        message=(
            "Invalid object ID for a user. Make sure to pass the right types, "
            "for instance making sure that the request is designed for users "
            "or otherwise look for a different one more suited"
        ),
    )


@pytest.mark.asyncio
async def test_add_user_to_group_retries_without_stale_access_hash() -> None:
    client = AsyncMock()
    # get_entity resolves: group, then the retry re-resolves the user.
    # (The initial user peer is built from the cached access_hash, so no
    # get_entity call for it.)
    client.get_entity = AsyncMock(
        side_effect=[_build_channel(1007), _build_user(84)]
    )
    # The invite RPC fails once with the stale-hash signature, then succeeds;
    # the third call is the post-add verification (GetParticipantRequest).
    client.side_effect = [_invalid_user_id_error(), None, None]

    result = await add_user_to_group(
        client, -1001007, 84, access_hash=999999999
    )

    assert result.success is True
    # The retry re-resolved the user (group + retry = 2 get_entity calls).
    assert client.get_entity.await_count == 2
    # The two invite attempts both used InviteToChannelRequest (megagroup);
    # the remaining calls are the post-add verification requests.
    invite_calls = [
        call.args[0]
        for call in client.call_args_list
        if isinstance(call.args[0], InviteToChannelRequest)
    ]
    assert len(invite_calls) == 2


@pytest.mark.asyncio
async def test_add_user_to_group_returns_unknown_when_retry_also_fails() -> None:
    client = AsyncMock()
    # get_entity resolves: group, then the retry re-resolves the user.
    client.get_entity = AsyncMock(
        side_effect=[_build_channel(1008), _build_user(85)]
    )
    client.side_effect = [
        _invalid_user_id_error(),
        RPCError(request=None, message="boom again"),
    ]

    result = await add_user_to_group(
        client, -1001008, 85, access_hash=999999999
    )

    assert result.success is False
    assert result.error_code == ERROR_UNKNOWN
