# Implementation Plan: Media File Support in Broadcast

**Branch**: `012-media-broadcast` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

## Summary

Add optional media URL support to the broadcast system. Each message in the `messages` array can have an associated media URL. If present, the runtime downloads the file and sends it via `client.send_file()` with the message text as caption. Text-only behavior is preserved when no media URL is provided.

## Technical Context

**Language/Version**: Python 3.11 + TypeScript (React)

**Primary Dependencies**: Telethon, aiohttp, structlog, tempfile

**Storage**: None (media URLs stored in job payload JSON, files downloaded to temp at send time)

**Testing**: Manual verification via broadcast form

**Constraints**: 
- Must not break existing text-only broadcasts
- Must handle download failures gracefully (fall back to text)
- Must clean up temp files after send
- Must apply to both members mode and groups mode

## Architecture

### Backend: `bot/agents/rpc_wrapper.py`

Add new function:
- `send_file_with_timeout(client, entity, text, media_url, timeout=120)`:
  1. Downloads file from `media_url` using `aiohttp.ClientSession` to a temp file
  2. Calls `client.send_file(entity, temp_path, caption=text)` via `call_with_retry`
  3. Cleans up temp file in `finally` block
  4. Falls back to `send_message_with_timeout` if download fails
  5. Logs `rpc_send_file_completed` / `rpc_send_file_failed` with timing

### Backend: `bot/agents/runtime.py`

- Modify the send loop in `GroupMemberBroadcastRuntime.execute()`:
  - Read `media_urls` from normalized payload
  - For each message, if `media_urls[i]` is set, call `send_file_with_timeout()`; else call `send_message_with_timeout()`
- Same change in `_execute_groups_mode()`
- Normalize `media_urls` in the payload (ensure it's a list, pad to match `messages` length)

### Backend: `bot/agents/jobs.py`

- Update `normalize_group_member_broadcast_payload()`:
  - Accept `media_urls` from raw payload
  - Normalize to a list of same length as `messages`, filling missing entries with None
  - Strip/validate URLs

### Frontend: `apps/miniapp-agents/src/pages/CampaignsPage.tsx`

- Add a URL input field next to each message textarea
- State: `bulkMediaUrls: (string | null)[]`
- Include `media_urls` in job payload

### Frontend: `bot/dashboard/frontend/index.html`

- Add URL input alongside the message textarea (single message mode)

## Files Changed

| File | Change |
|------|--------|
| `bot/agents/rpc_wrapper.py` | Add `send_file_with_timeout()` |
| `bot/agents/runtime.py` | Modify send loop to check `media_urls` |
| `bot/agents/jobs.py` | Normalize `media_urls` in payload |
| `apps/miniapp-agents/src/pages/CampaignsPage.tsx` | Add media URL inputs |
| `bot/dashboard/frontend/index.html` | Add media URL input |
