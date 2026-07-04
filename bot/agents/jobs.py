from __future__ import annotations

from typing import Any

GROUP_MEMBER_BROADCAST_JOB_TYPE = "group_member_broadcast"
ADD_CONTACT_JOB_TYPE = "add_contact"
SCRAPER_GROUP_INFO_JOB_TYPE = "scraper_group_info"
SCRAPER_MEMBERS_JOB_TYPE = "scraper_members"
SCRAPER_MESSAGES_JOB_TYPE = "scraper_messages"
SCRAPER_FULL_GROUP_JOB_TYPE = "scraper_full_group"

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

    result: dict[str, Any] = {
        "target_type": target_type,
        "source_group_title": source_group_title,
        "messages": messages,
        "message": "\n\n".join(messages),
        "threshold": threshold,
        "interval_seconds": interval_seconds,
        "interval_between_contacts": float(normalized.get("interval_between_contacts") or interval_seconds),
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
