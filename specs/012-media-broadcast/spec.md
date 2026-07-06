# Feature Specification: Media File Support in Broadcast

**Feature Branch**: `012-media-broadcast`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User request — "adding media file support to the broadcast"

## User Scenarios & Testing

### User Story 1 — Send Image Alongside Text (Priority: P1)

As an agent operator, I want to attach an image (photo) to a broadcast message so that recipients see media + caption instead of plain text only.

**Why this priority**: This is the core request — being able to send media files (images, videos, documents) in bulk broadcasts.

**Independent Test**:
- Create a broadcast job with a media URL, verify `client.send_file()` is called with the correct parameters
- Verify the file is downloaded from the URL, sent to Telegram, then cleaned up

**Acceptance Scenarios**:

1. **Given** a broadcast payload with `media_urls[i]` set to a valid image URL, **When** the message is sent, **Then** the recipient receives the image with the message text as caption
2. **Given** a broadcast payload with `media_urls[i]` set to null, **When** the message is sent, **Then** the existing text-only behavior is preserved
3. **Given** a broadcast payload with `media_urls` shorter than `messages`, **When** sent, **Then** missing entries are treated as text-only
4. **Given** a media URL that fails to download, **When** sending, **Then** the error is logged and the message text is sent without media (graceful fallback)

### User Story 2 — Multiple Messages With Mixed Media (Priority: P2)

As an agent operator, I want some messages in the sequence to have media and others to be text-only.

**Acceptance Scenarios**:

1. **Given** `messages = ["img msg", "text only"]` and `media_urls = ["https://...", null]`, **When** the broadcast runs, **Then** the first message is sent as media+caption and the second as text-only

## Technical Design

### Payload Schema

Add `media_urls` field to the broadcast payload:

```json
{
  "messages": ["Caption text", "Plain text"],
  "media_urls": ["https://example.com/photo.jpg", null],
  ...
}
```

- `media_urls` is an array parallel to `messages`, same length or shorter
- Each entry is either a string (URL) or null/empty (text-only)
- If `media_urls` is not provided or empty, all messages are text-only (backward compatible)

### Send Logic

New wrapper `send_file_with_timeout()`:
- Downloads the file from the URL using `aiohttp` to a `tempfile.NamedTemporaryFile`
- Calls `client.send_file(entity, file_path, caption=text)` with a timeout
- Cleans up the temp file
- Falls back to text-only send if download fails

The send loop checks if `media_urls[i]` exists and calls the appropriate function.

### Frontend

In the React mini-app (`CampaignsPage.tsx`), add a URL input field next to each message textarea for optional media URL.
