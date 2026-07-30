from __future__ import annotations

from typing import Any

GROUP_MEMBER_BROADCAST_JOB_TYPE = "group_member_broadcast"
ADD_CONTACT_JOB_TYPE = "add_contact"
MEMBER_ADD_JOB_TYPE = "member_add"
SCRAPER_GROUP_INFO_JOB_TYPE = "scraper_group_info"
SCRAPER_MEMBERS_JOB_TYPE = "scraper_members"
SCRAPER_MESSAGES_JOB_TYPE = "scraper_messages"
SCRAPER_FULL_GROUP_JOB_TYPE = "scraper_full_group"
KNOWLEDGE_EXTRACTION_JOB_TYPE = "knowledge_extraction"

GRADUATED_INTERVAL_TIERS: list[tuple[int, float]] = [
    (50, 30.0),
    (100, 60.0),
    (200, 120.0),
    (400, 180.0),
    (-1, 300.0),
]


def get_interval_for_contact(
    cumulative_sent: int,
    strategy: str,
    custom_interval: float | None = None,
) -> float:
    if strategy == "fixed" and custom_interval is not None and custom_interval > 0:
        return custom_interval
    for threshold, interval in GRADUATED_INTERVAL_TIERS:
        if threshold == -1 or cumulative_sent < threshold:
            return interval
    return 300.0


# AgentJob statuses
JOB_STATUS_PENDING = "pending"
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_ABORTED = "aborted"
JOB_STATUS_SCHEDULED = "scheduled"
JOB_STATUS_ENQUEUE_FAILED = "enqueue_failed"
JOB_STATUS_DISPATCH_STALE = "dispatch_stale"


def _normalize_group_reference(value: Any) -> int | str:
    if isinstance(value, int):
        return value
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("source_group_id is required")
    if raw.lstrip("-").isdigit():
        return int(raw)
    return raw


def normalize_group_member_broadcast_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(payload or {})

    messages_raw = normalized.get("messages")
    if not messages_raw:
        message = str(normalized.get("message") or "").strip()
        messages_raw = [message] if message else []
    messages = [str(m).strip() for m in messages_raw if str(m).strip()]
    if not messages:
        raise ValueError("messages is required")

    target_type = str(normalized.get("target_type", "members")).strip().lower()
    if target_type not in ("members", "groups"):
        raise ValueError("target_type must be 'members' or 'groups'")

    source_group_title = str(normalized.get("source_group_title") or "").strip()

    try:
        threshold = int(normalized.get("threshold"))
    except (TypeError, ValueError) as exc:
        raise ValueError("threshold must be a positive integer") from exc
    if threshold <= 0:
        raise ValueError("threshold must be a positive integer")

    interval_raw = normalized.get("interval_seconds", 0)
    try:
        interval_seconds = float(interval_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("interval_seconds must be a non-negative number") from exc
    if interval_seconds < 0:
        raise ValueError("interval_seconds must be a non-negative number")

    interval_between_contacts = float(
        normalized.get("interval_between_contacts") or interval_seconds
    )
    has_explicit_interval = normalized.get("interval_between_contacts") is not None
    interval_strategy = str(normalized.get("interval_strategy") or "").strip().lower()
    if not interval_strategy:
        interval_strategy = (
            "fixed" if has_explicit_interval and interval_between_contacts > 0 else "graduated"
        )
    if interval_strategy not in ("graduated", "fixed"):
        raise ValueError("interval_strategy must be 'graduated' or 'fixed'")

    media_urls_raw = normalized.get("media_urls")
    if isinstance(media_urls_raw, list):
        media_urls = [
            str(u).strip() if u is not None and str(u).strip() else None for u in media_urls_raw
        ]
    else:
        media_urls = []

    if len(media_urls) < len(messages):
        media_urls += [None] * (len(messages) - len(media_urls))

    result: dict[str, Any] = {
        "target_type": target_type,
        "source_group_title": source_group_title,
        "messages": messages,
        "media_urls": media_urls[: len(messages)],
        "message": "\n\n".join(messages),
        "threshold": threshold,
        "interval_seconds": interval_seconds,
        "interval_between_contacts": interval_between_contacts,
        "interval_strategy": interval_strategy,
        "skip_bots": bool(normalized.get("skip_bots", True)),
    }

    if target_type == "members":
        source_group_id = _normalize_group_reference(normalized.get("source_group_id"))
        if source_group_id is None:
            raise ValueError("source_group_id is required for target_type=members")
        result["source_group_id"] = source_group_id

        selected_user_ids: list[int] = []
        for value in list(normalized.get("selected_user_ids") or []):
            try:
                user_id = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("selected_user_ids must contain valid integer user ids") from exc
            if user_id <= 0:
                raise ValueError("selected_user_ids must contain valid integer user ids")
            if user_id not in selected_user_ids:
                selected_user_ids.append(user_id)
        result["selected_user_ids"] = selected_user_ids
    else:
        target_group_ids: list[int] = []
        for value in list(normalized.get("target_group_ids") or []):
            try:
                gid = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("target_group_ids must contain valid integer group ids") from exc
            if gid == 0:
                raise ValueError("target_group_ids must contain valid integer group ids")
            if gid not in target_group_ids:
                target_group_ids.append(gid)
        if not target_group_ids:
            raise ValueError("target_group_ids is required for target_type=groups")
        result["target_group_ids"] = target_group_ids

    return result


def normalize_member_add_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(payload or {})
    target_tg_group_id = normalized.get("target_tg_group_id")
    if target_tg_group_id is None:
        raise ValueError("target_tg_group_id is required")
    try:
        target_tg_group_id = int(target_tg_group_id)
    except (TypeError, ValueError):
        raise ValueError("target_tg_group_id must be a valid integer")
    if target_tg_group_id == 0:
        raise ValueError("target_tg_group_id must be non-zero")

    user_ids: list[int] = []
    for value in list(normalized.get("user_ids") or []):
        try:
            uid = int(value)
        except (TypeError, ValueError):
            continue
        if uid > 0 and uid not in user_ids:
            user_ids.append(uid)
    if not user_ids:
        raise ValueError("At least one valid user_id is required")

    interval_raw = normalized.get("interval_seconds", 20)
    try:
        interval_seconds = float(interval_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("interval_seconds must be a non-negative number") from exc
    if interval_seconds < 0:
        raise ValueError("interval_seconds must be a non-negative number")

    send_invite_link = bool(normalized.get("send_invite_link_on_privacy_restricted", False))
    source_tg_group_id = normalized.get("source_tg_group_id")
    if source_tg_group_id is not None:
        try:
            source_tg_group_id = int(source_tg_group_id)
        except (TypeError, ValueError):
            source_tg_group_id = None

    result = {
        "target_tg_group_id": target_tg_group_id,
        "user_ids": user_ids,
    }
    if source_tg_group_id is not None:
        result["source_tg_group_id"] = source_tg_group_id
    result.update({
        "interval_seconds": interval_seconds,
        "send_invite_link_on_privacy_restricted": send_invite_link,
    })
    return result
