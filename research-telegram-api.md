# Telegram API Research — Member Management, Messaging & Scraping

> Date: 2026-07-13
> Sources: Official Telegram API docs, Telethon source (GitHub/Codeberg v1), Telegram API error database

---

## 1. Adding Members to Groups/Channels

### 1.1 API Methods

| Method | Applies to | Description |
|--------|-----------|-------------|
| `channels.inviteToChannel` | Supergroups & Channels | Invite users to a channel/supergroup |
| `messages.addChatUser` | Basic groups | Adds a user to a chat and sends a service message |

**Source:**
- https://core.telegram.org/method/channels.inviteToChannel
- https://core.telegram.org/method/messages.addChatUser
- https://core.telegram.org/api/invites#direct-invites

**TL Schema:**

```
channels.inviteToChannel#c9e33d54 channel:InputChannel users:Vector<InputUser> = messages.InvitedUsers;

messages.addChatUser#cbc6d107 chat_id:long user_id:InputUser fwd_limit:int = messages.InvitedUsers;

messages.invitedUsers#7f5defa6 updates:Updates missing_invitees:Vector<MissingInvitee> = messages.InvitedUsers;
```

### 1.2 Invite Links

Alternative to direct invites — `messages.exportChatInvite`, `messages.editExportedChatInvite`, `messages.importChatInvite`.

**Source:** https://core.telegram.org/api/invites

### 1.3 Permissions Required

Both `channels.inviteToChannel` and `messages.addChatUser` return `CHAT_ADMIN_REQUIRED` (403) if the calling user is not an admin with invite permissions.

The `chatAdminRights.invite_users` flag controls whether an admin can invite users.

**Source:**
- https://core.telegram.org/api/rights
- https://core.telegram.org/method/channels.inviteToChannel (see `CHAT_ADMIN_REQUIRED` error)
- https://core.telegram.org/method/messages.addChatUser (see `CHAT_ADMIN_REQUIRED` error)

### 1.4 Result Type — `messages.InvitedUsers` / `MissingInvitee`

The result includes `missing_invitees` — users that could not be invited:

```
missingInvitee#628c9224 flags:# 
  premium_would_allow_invite:flags.0?true 
  premium_required_for_pm:flags.1?true 
  user_id:long = MissingInvitee;
```

- No flags set → could not add due to privacy settings (share invite link instead)
- `premium_would_allow_invite` → current account needs Telegram Premium
- `premium_required_for_pm` → privacy + Premium needed to DM an invite link

**Source:** https://core.telegram.org/api/invites#direct-invites

### 1.5 Error Codes

#### `channels.inviteToChannel` errors

| Code | Type | Description |
|------|------|-------------|
| 400 | `BOTS_TOO_MUCH` | Too many bots in this chat/channel |
| 400 | `BOT_GROUPS_BLOCKED` | Bot can't be added to groups |
| 400 | `CHANNEL_INVALID` | Invalid channel |
| 400 | `CHANNEL_MONOFORUM_UNSUPPORTED` | Monoforums don't support this |
| 406 | `CHANNEL_PRIVATE` | You haven't joined |
| 403 | `CHAT_ADMIN_REQUIRED` | Must be admin |
| 400 | `CHAT_MEMBER_ADD_FAILED` | Could not add participants |
| 403 | `CHAT_WRITE_FORBIDDEN` | Can't write in this chat |
| 400 | `INPUT_USER_DEACTIVATED` | User was deleted |
| 400 | `USERS_TOO_MUCH` | Max users exceeded |
| 400 | `USER_BANNED_IN_CHANNEL` | You're banned from sending messages |
| 400 | `USER_BLOCKED` | User blocked |
| 400 | `USER_BOT` | Bots can only be admins in channels |
| 403 | `USER_CHANNELS_TOO_MUCH` | User is in too many channels |
| 400 | `USER_ID_INVALID` | Invalid user ID |
| 400 | `USER_KICKED` | User was kicked from this group |
| 403 | `USER_NOT_MUTUAL_CONTACT` | Not a mutual contact |
| 403 | `USER_PRIVACY_RESTRICTED` | User's privacy settings prevent this |

#### `messages.addChatUser` errors

Includes all above plus:
| 400 | `USER_ALREADY_PARTICIPANT` | User is already in the group |
| 400 | `USER_IS_BLOCKED` | You were blocked by this user |
| 400 | `YOU_BLOCKED_USER` | You blocked this user |

**Source:**
- https://core.telegram.org/method/channels.inviteToChannel#possible-errors
- https://core.telegram.org/method/messages.addChatUser#possible-errors

### 1.6 Telegram Limits

| Entity | Max Members |
|--------|-------------|
| Basic group (`chat`) | **200** members |
| Supergroup (`channel` with `megagroup` flag) | **200,000** members |
| Gigagroup | No limit (but only admins can write) |
| Channel | Unlimited subscribers |

**Source:** https://core.telegram.org/api/channel

## 2. Recent Changes / Updates (2024–2026)

### 2.1 Layer Changelog

Current layer: **225** (as of latest documentation release).

Key recent changes relevant to this research:

- **Layer 223**: `missingInvitee` flags `premium_would_allow_invite` and `premium_required_for_pm` documented. User tags in groups.
- **Layer 224**: `messages.composeMessageWithAI` added. Managed bots. Open-answer polls. Message views and read metrics.
- **Layer 225**: AI compose tones. Guest mode for bots. Poll statistics. Participant reaction moderation. Passkeys. Gift auctions. Live stories. Repeating scheduled messages. Message views/read metrics.

**Source:** https://core.telegram.org/api/layers

### 2.2 Error Database Now Published as JSON

The RPC error database is now published at `/api/errors.json` permalink as a machine-readable JSON file.

**Source:** https://core.telegram.org/api/errors#error-database

### 2.3 No Recent Changes to Bulk-Add API

No new methods for bulk-adding members were introduced through layer 225. The existing `channels.inviteToChannel` (which accepts `Vector<InputUser>`) remains the primary method for adding multiple users at once.

### 2.4 Telethon Repository Archived

The Telethon GitHub repository was archived on Feb 21, 2026 and moved to Codeberg at https://codeberg.org/Lonami/Telethon. The v1 branch remains available.

**Source:** https://github.com/LonamiWebs/Telethon

## 3. Sending Messages

### 3.1 API Method

`messages.sendMessage` is the primary method for sending messages via MTProto (user accounts or bots).

**Source:** https://core.telegram.org/method/messages.sendMessage

### 3.2 Rate Limits

| Limit Type | Scope | Detail |
|-----------|-------|--------|
| `FLOOD_WAIT_X` | Per-method, per-session | General rate limit; wait X seconds |
| `FLOOD_PREMIUM_WAIT_X` | Per-method | Premium can remove some limits |
| `SLOWMODE_WAIT_X` | Per-chat | Chat-specific slowmode; wait X seconds |
| Bot broadcast limit | Per bot | ~30 messages/second normally |
| `allow_paid_floodskip` | Bots only | Pay 0.1 Stars/msg to send up to 1000 msg/s |

The `FLOOD_WAIT_X` error pattern: `"Please wait %d seconds before repeating the action."`

**Source:**
- https://core.telegram.org/api/errors#420-flood
- https://core.telegram.org/method/messages.sendMessage (see `allow_paid_floodskip` parameter)

### 3.3 Bot API vs MTProto (User API) Messaging

| Aspect | Bot API (HTTP) | MTProto (User API) |
|--------|---------------|-------------------|
| Protocol | REST over HTTPS | Binary MTProto |
| Message limit | 4096 chars | 35,000 bytes / 4096 chars (Telethon) |
| Rate limiting | ~30 msg/s (broadcast), 1 msg/s (group) | Flood wait system |
| Paid flood skip | Not available | `allow_paid_floodskip` flag (layer 223+) |
| `send_as` | Not available | Can send on behalf of owned channels |

**Source:** https://core.telegram.org/method/messages.sendMessage
**Telethon source:** https://codeberg.org/Lonami/Telethon/raw/branch/v1/telethon/client/messages.py (lines reference 35,000 byte / 4096 char limit in docstring)

## 4. Scraping Members

### 4.1 API Methods

| Method | Applies to | Description |
|--------|-----------|-------------|
| `channels.getParticipants` | Supergroups & Channels | Get participants with filter, offset, limit, hash |
| `messages.getFullChat` | Basic groups | Returns full participant list directly in `chatFull` |

**Source:**
- https://core.telegram.org/method/channels.getParticipants
- https://core.telegram.org/method/messages.getFullChat
- https://core.telegram.org/api/channel#basic-group-participants

### 4.2 Telethon Implementation

```python
_MAX_PARTICIPANTS_CHUNK_SIZE = 200
```

Telethon paginates `channels.getParticipants` in chunks of 200, using `offset` and `limit` parameters. For basic groups, it fetches all participants at once via `messages.getFullChat`.

**Source:** https://codeberg.org/Lonami/Telethon/raw/branch/v1/telethon/client/chats.py (lines 15, 67-75 for _MAX_PARTICIPANTS_CHUNK_SIZE and pagination logic)

### 4.3 Limits

| Parameter | Limit |
|-----------|-------|
| `limit` per request | Up to 200 (Telethon default chunk) |
| Total participants (supergroup) | Up to 200,000 |
| Total participants (basic group) | Up to 200 (returned in full) |
| Filters available | `ChannelParticipantsRecent`, `ChannelParticipantsAdmins`, `ChannelParticipantsKicked`, `ChannelParticipantsBanned`, `ChannelParticipantsSearch`, `ChannelParticipantsContacts`, `ChannelParticipantsBots` |

**Source:**
- https://core.telegram.org/method/channels.getParticipants
- https://core.telegram.org/api/channel

### 4.4 Note on "Aggressive" Mode

The Telethon `aggressive` parameter in `iter_participants` is documented as deprecated:

> There have been several changes to Telegram's API that limits the amount of members that can be retrieved, and this was a hack that no longer works.

**Source:** https://codeberg.org/Lonami/Telethon/raw/branch/v1/telethon/client/chats.py (see `iter_participants` docstring)

### 4.5 Flood Limits for Scraping

All API calls including `channels.getParticipants` are subject to `FLOOD_WAIT_X` errors. The general flood error pattern applies:

```
FLOOD_WAIT_%d: "Please wait %d seconds before repeating the action."
```

**Source:** https://core.telegram.org/api/errors#error-database

---

## Summary of Key Constraints

| Operation | Requirement | Limit |
|-----------|-------------|-------|
| Add user to supergroup/channel | Admin with `invite_users` right | Per-request flood limit |
| Add user to basic group | Admin | 200 max users in group |
| Fetch participants (supergroup) | Any member (or admin if restricted) | Paginated, 200/chunk |
| Fetch participants (basic group) | Any member | Full list in 1 call |
| Send message | Member (or admin if restricted) | Flood wait / slowmode |
| Privacy-restricted user | Cannot be directly added | Must use invite link |
| User in too many channels | Cannot be added | `USER_CHANNELS_TOO_MUCH` |
| Premium bypass | Premium account may allow inviting privacy-restricted users | `premium_would_allow_invite` flag |
