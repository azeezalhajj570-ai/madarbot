# Tasks: Media File Support in Broadcast

**Input**: Design documents from `specs/012-media-broadcast/`

## Phase 1: Backend Send Logic

**Purpose**: Add `send_file_with_timeout()` wrapper and integrate into broadcast runtime

- [ ] T001 Add `send_file_with_timeout()` to `bot/agents/rpc_wrapper.py`
      - Downloads file from URL via `aiohttp` to temp file
      - Calls `client.send_file()` with caption
      - Cleans up temp file in `finally`
      - Falls back to text-only send on download failure
      - Logs `rpc_send_file_*` events with timing

- [ ] T02 Update `normalize_group_member_broadcast_payload()` in `bot/agents/jobs.py`
      - Accept `media_urls` field
      - Normalize to list matching `messages` length (pad with None)
      - Strip whitespace from URLs

- [ ] T003 Modify `GroupMemberBroadcastRuntime.execute()` in `bot/agents/runtime.py`
      - Read `media_urls` from normalized payload
      - In the send loop, check `media_urls[mi]` and call `send_file_with_timeout()` or `send_message_with_timeout()` accordingly
      - Apply the same change in `_execute_groups_mode()`

## Phase 2: Frontend

**Purpose**: Add media URL input to broadcast forms

- [ ] T004 Update `CampaignsPage.tsx` in React mini-app
      - Add `bulkMediaUrls` state alongside `bulkMessages`
      - Render URL input next to each message textarea
      - Include `media_urls` in job payload

- [ ] T005 Update `index.html` (legacy dashboard)
      - Add URL input next to message textarea in bulk message form

## Phase 3: Verify

**Purpose**: Build, deploy, and smoke-test

- [ ] T006 Build and restart agent_worker + backend
- [ ] T007 Verify text-only broadcast still works
- [ ] T008 Verify media URL broadcast works (manual test)
