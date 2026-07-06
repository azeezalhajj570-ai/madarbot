"""Dedicated Dramatiq worker entry point for agent jobs."""

from __future__ import annotations

import logging
import sys

import dramatiq
from dramatiq.middleware.current_message import CurrentMessage
import structlog
from sqlalchemy import select

from bot.agents.agent_notification_service import AgentNotificationService
from bot.agents.exceptions import (
    AgentBannedError,
    AgentFloodWaitError,
    AgentSessionError,
    AgentSessionRevokedError,
)
from bot.agents.jobs import (
    ADD_CONTACT_JOB_TYPE,
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    JOB_STATUS_PENDING,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_FAILED,
    JOB_STATUS_ABORTED,
    JOB_STATUS_ENQUEUE_FAILED,
    SCRAPER_FULL_GROUP_JOB_TYPE,
    SCRAPER_GROUP_INFO_JOB_TYPE,
    SCRAPER_MEMBERS_JOB_TYPE,
    SCRAPER_MESSAGES_JOB_TYPE,
)
from bot.agents.runtime import (
    AddContactRuntime,
    AgentTaskRuntime,
    GroupMemberBroadcastRuntime,
    ScraperRuntime,
)
from bot.agents.session import SessionManager
from bot.automation.registry import build_default_registry
from bot.db import session as db_session
from bot.db.models import Agent, AgentJob, ScrapedMessage
from bot.services.scrapers.conversation_builder import build_conversations_from_scrape
from bot.workers.app import redis_broker  # noqa: F401


logger = structlog.get_logger(__name__)

from bot.config import get_settings as _get_worker_settings

_worker_settings = _get_worker_settings()
if (
    _worker_settings.bot_app_kind in ("admin", "agents")
    and not _worker_settings.session_encryption_key
):
    logging.getLogger(__name__).critical(
        "SESSION_ENCRYPTION_KEY is not configured. "
        "Agent session strings would be stored in plaintext. Refusing to start worker. "
        "Set SESSION_ENCRYPTION_KEY in your .env file."
    )
    sys.exit(1)

_DEFAULT_SESSION_LOCAL = db_session.SessionLocal
SessionLocal = _DEFAULT_SESSION_LOCAL


def _session_local_factory():
    local_session_factory = SessionLocal
    if local_session_factory is not _DEFAULT_SESSION_LOCAL:
        return local_session_factory
    return db_session.SessionLocal


def _task_label(task_key: str) -> str:
    return task_key.replace("_", " ").strip() or "task"


def _trim_message(value: str, limit: int = 96) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3].rstrip()}..."


def _format_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _build_job_notification(
    job: AgentJob, *, status: str, result: dict | None = None, error: str | None = None
) -> tuple[str, str, str, dict[str, object]] | None:
    payload = dict(job.job_payload or {})
    result_payload = dict(result or payload.get("result") or {})

    if job.job_type == GROUP_MEMBER_BROADCAST_JOB_TYPE:
        target_type = str(
            result_payload.get("target_type") or payload.get("target_type") or "members"
        )
        group_title = str(
            result_payload.get("source_group_title") or payload.get("source_group_title") or ""
        ).strip()
        sent_count = int(
            result_payload.get("success_count") or result_payload.get("sent_count") or 0
        )
        attempted_count = int(
            result_payload.get("total_count") or result_payload.get("attempted_count") or 0
        )
        failed_count = int(
            result_payload.get("failure_count") or result_payload.get("failed_count") or 0
        )
        selected_count = len(list(payload.get("selected_user_ids") or []))
        notification_payload = {
            "job_type": job.job_type,
            "target_type": target_type,
            "source_group_title": group_title,
            "sent_count": sent_count,
            "attempted_count": attempted_count,
            "failed_count": failed_count,
            "selected_count": selected_count,
        }
        if status == JOB_STATUS_COMPLETED:
            label = "groups" if target_type == "groups" else "members"
            body = f"Sent to {sent_count} {label}."
            if failed_count:
                body = f"Sent to {sent_count} {label}, {failed_count} failed."
            failures = result_payload.get("failures", [])
            if isinstance(failures, list) and len(failures) > 5:
                body += f" {len(failures)} total failures."
            return "bulk_message_completed", "Bulk message completed", body, notification_payload
        if status == JOB_STATUS_FAILED:
            prefix = f"{group_title}: " if group_title else ""
            return (
                "bulk_message_failed",
                "Bulk message failed",
                f"{prefix}{_trim_message(error or 'The bulk message could not be sent.')}",
                notification_payload,
            )
        return None

    if job.job_type == ADD_CONTACT_JOB_TYPE:
        full_name = (
            " ".join(
                part
                for part in [
                    str(result_payload.get("first_name") or ""),
                    str(result_payload.get("last_name") or ""),
                ]
                if part
            ).strip()
            or "User"
        )
        user_id = str(result_payload.get("user_id") or payload.get("user_id") or "unknown")
        notification_payload = {
            "job_type": job.job_type,
            "user_id": user_id,
            "full_name": full_name,
        }
        if status == JOB_STATUS_COMPLETED:
            return (
                "contact_saved",
                "Contact saved",
                f"{full_name} ({user_id}) has been added to your Telegram contacts.",
                notification_payload,
            )
        if status == JOB_STATUS_FAILED:
            return (
                "contact_save_failed",
                "Failed to save contact",
                f"Could not save {full_name} ({user_id}) to contacts: {error}",
                notification_payload,
            )
        return None

    if job.job_type == "send_lead_message":
        tg_user_id = str(payload.get("tg_user_id") or "unknown")
        msg_text = str(payload.get("message") or "").strip()
        mode = str(payload.get("mode") or "private")
        notification_payload = {
            "job_type": job.job_type,
            "tg_user_id": tg_user_id,
            "message": _trim_message(msg_text, 80) if msg_text else "",
            "mode": mode,
        }
        if status == JOB_STATUS_COMPLETED:
            ts = _format_timestamp()
            if mode == "forward":
                body = f"Original message forwarded. — {ts}"
            elif mode in ("public", "group"):
                body = f"Lead message sent in group. — {ts}"
            else:
                body = f"Contact sent to user {tg_user_id}. — {ts}"
            return ("lead_message_sent", "Lead contacted", body, notification_payload)
        if status == JOB_STATUS_FAILED:
            return (
                "lead_message_failed",
                "Failed to contact lead",
                _trim_message(error or "Could not send lead message."),
                notification_payload,
            )
        return None

    if job.job_type == "automation_task":
        task_key = str(payload.get("task_key") or "automation_task")
        event_payload = dict((payload.get("event") or {}).get("payload") or {})
        keyword = str((payload.get("conditions") or {}).get("text_contains") or "").strip()
        destination = str((payload.get("task_config") or {}).get("destination") or "").strip()
        group_title = str(event_payload.get("group_title") or "").strip()
        notification_payload = {
            "job_type": job.job_type,
            "task_key": task_key,
            "task_label": _task_label(task_key).title(),
            "keyword": keyword,
            "destination": destination,
            "group_title": group_title,
        }
        if status == JOB_STATUS_COMPLETED:
            body = f"{_task_label(task_key).title()} executed."
            if keyword:
                body = f'{_task_label(task_key).title()} ran for "{_trim_message(keyword, 40)}".'
            elif group_title:
                body = f"{_task_label(task_key).title()} executed for {group_title}."
            return ("task_completed", "Task executed", body, notification_payload)
        if status == JOB_STATUS_FAILED:
            return (
                "task_failed",
                "Task failed",
                _trim_message(error or f"{_task_label(task_key).title()} could not be completed."),
                notification_payload,
            )
        return None

    if job.job_type in {
        SCRAPER_GROUP_INFO_JOB_TYPE,
        SCRAPER_MEMBERS_JOB_TYPE,
        SCRAPER_MESSAGES_JOB_TYPE,
        SCRAPER_FULL_GROUP_JOB_TYPE,
    }:
        group_info = dict(result_payload.get("group_info") or {})
        members = dict(result_payload.get("members") or {})
        messages = dict(result_payload.get("messages") or {})
        group_title = str(group_info.get("title") or payload.get("group_title") or "").strip()

        # members_count should include those from member list AND those found in messages
        members_direct = int(
            result_payload.get("success_count") or members.get("success_count") or 0
        )
        members_from_messages = int(
            result_payload.get("member_success_count") or messages.get("member_success_count") or 0
        )
        members_count = members_direct + members_from_messages

        messages_count = int(
            result_payload.get("messages_count") or messages.get("success_count") or 0
        )
        notification_payload = {
            "job_type": job.job_type,
            "group_title": group_title,
            "members_count": members_count,
            "messages_count": messages_count,
            "members_direct": members_direct,
            "members_from_messages": members_from_messages,
        }
        if status == JOB_STATUS_COMPLETED:
            ts = _format_timestamp()
            if job.job_type == SCRAPER_GROUP_INFO_JOB_TYPE:
                body = group_title or "Group details refreshed."
            elif job.job_type == SCRAPER_MESSAGES_JOB_TYPE:
                body = f"{members_count} members identified, {messages_count} messages scraped."
            elif job.job_type == SCRAPER_MEMBERS_JOB_TYPE:
                body = f"{members_count} members scraped."
            else:
                body = f"{members_count} members synced and {messages_count} messages scraped."
            if group_title and job.job_type != SCRAPER_GROUP_INFO_JOB_TYPE:
                body = f"{group_title}: {body}"
            body = f"{body} — {ts}"
            return ("scrape_completed", "Scrape finished", body, notification_payload)
        if status == JOB_STATUS_FAILED:
            prefix = f"{group_title}: " if group_title else ""
            return (
                "scrape_failed",
                "Scrape failed",
                f"{prefix}{_trim_message(error or 'The scrape job did not finish.')}",
                notification_payload,
            )
        return None

    if status == JOB_STATUS_FAILED:
        return (
            "job_failed",
            "Job failed",
            _trim_message(error or "The agent job failed."),
            {"job_type": job.job_type},
        )
    return None


async def _create_job_notification(
    session,
    job: AgentJob,
    *,
    status: str,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    try:
        details = _build_job_notification(job, status=status, result=result, error=error)
        if details is None:
            return
        kind, title, body, payload = details
        agent = (
            await session.execute(select(Agent).where(Agent.id == job.agent_id))
        ).scalar_one_or_none()
        if agent is None:
            return
        await AgentNotificationService(session).create_notification(
            actor_user_id=None,
            agent=agent,
            kind=kind,
            title=title,
            body=body,
            payload=payload,
        )
    except Exception:
        logger.exception("agent_job_notification_failed", job_id=job.id)
        try:
            await session.rollback()
        except Exception:
            pass


async def _set_job_state(
    session,
    job_id: int,
    status: str,
    *,
    result: dict | None = None,
    error: str | None = None,
) -> AgentJob | None:
    try:
        job = (
            await session.execute(select(AgentJob).where(AgentJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            return None
        payload = dict(job.job_payload or {})
        if result is not None:
            payload["result"] = result
        if error is not None:
            payload["last_error"] = error
        job.job_payload = payload
        job.status = status
        await session.commit()
        if status in {JOB_STATUS_COMPLETED, JOB_STATUS_FAILED}:
            await _create_job_notification(session, job, status=status, result=result, error=error)
        return job
    except Exception:
        logger.exception("agent_job_set_state_failed", job_id=job_id)
        try:
            await session.rollback()
        except Exception:
            pass
        return None


async def _handle_send_lead_message(*, client, session, job: AgentJob) -> dict:
    payload = dict(job.job_payload or {})
    tg_user_id = int(payload.get("tg_user_id") or 0)
    if not tg_user_id:
        raise ValueError("tg_user_id is required")
    message = str(payload.get("message") or "").strip()
    mode = str(payload.get("mode") or "private")
    source_group_tg_id = int(payload.get("source_group_tg_id") or 0)
    source_message_id = int(payload.get("source_message_id") or 0)

    if mode == "forward":
        if not source_group_tg_id or not source_message_id:
            raise ValueError(
                "source_group_tg_id and source_message_id are required for forward mode"
            )
        sent = await client.forward_messages(
            entity=tg_user_id,
            messages=source_message_id,
            from_peer=source_group_tg_id,
        )
        result = {
            "sent": True,
            "forwarded": True,
            "message_ids": sent if isinstance(sent, list) else [sent.id],
            "chat_id": tg_user_id,
            "mode": "forward",
        }
        if message:
            follow_up = await client.send_message(tg_user_id, message)
            result["follow_up_message_id"] = follow_up.id
        return result

    if not message:
        raise ValueError("message is required")
    include_original = bool(payload.get("include_original"))
    original_text = str(payload.get("original_text") or "").strip()

    full_text = message
    if include_original and original_text:
        full_text = f"{message}\n\n{original_text}"

    if mode in ("public", "group") and source_group_tg_id:
        kwargs = {}
        if source_message_id:
            kwargs["reply_to"] = source_message_id
        sent = await client.send_message(source_group_tg_id, full_text, **kwargs)
        return {"sent": True, "message_id": sent.id, "chat_id": source_group_tg_id, "mode": "group"}
    else:
        sent = await client.send_message(tg_user_id, full_text)
        return {"sent": True, "message_id": sent.id, "chat_id": tg_user_id, "mode": "private"}


async def _try_auto_broadcast_dispatch(
    session,
    agent: Agent,
    job_payload: dict,
    bound_logger,
) -> None:
    if not agent.auto_broadcast_enabled or not agent.auto_broadcast_template:
        return
    source_group_id = job_payload.get("source_group_id") or job_payload.get("group_id")
    if not source_group_id:
        bound_logger.debug("agent_auto_broadcast_skipped_no_group_id")
        return
    from bot.db.models.scraper import ScrapedMember
    from sqlalchemy import func, select

    member_count = await session.scalar(
        select(func.count())
        .select_from(ScrapedMember)
        .where(ScrapedMember.scraped_group_id == int(source_group_id))
    )
    if not member_count or member_count == 0:
        bound_logger.debug("agent_auto_broadcast_skipped_empty_group")
        return

    new_job = AgentJob(
        agent_id=agent.id,
        job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
        job_payload={
            "source_group_id": int(source_group_id),
            "messages": [agent.auto_broadcast_template],
            "target_type": "members",
            "threshold": 500,
            "skip_bots": True,
        },
        status=JOB_STATUS_PENDING,
    )
    session.add(new_job)
    await session.commit()
    try:
        from bot.agents.dispatch import dispatch_agent_job

        await dispatch_agent_job(new_job.id)
    except Exception:
        bound_logger.exception("agent_auto_broadcast_dispatch_failed")
    bound_logger.info(
        "agent_auto_broadcast_dispatched",
        group_id=source_group_id,
        member_count=member_count,
        new_job_id=new_job.id,
    )


async def _execute_agent_job_impl(agent_id: int, job_id: int) -> None:
    message = CurrentMessage.get_current_message()
    message_options = message.options or {} if message is not None else {}
    retries = int(message_options.get("retries", 0))
    attempt = retries + 1
    max_retries = message_options.get("max_retries")
    final_attempt = max_retries is not None and retries >= int(max_retries)
    bound_logger = logger.bind(agent_id=agent_id, job_id=job_id, attempt=attempt)
    bound_logger.info("agent_job_started")

    session_manager = SessionManager()
    runtime = AgentTaskRuntime(registry=build_default_registry())
    broadcast_runtime = GroupMemberBroadcastRuntime()
    scraper_runtime = ScraperRuntime()
    contact_runtime = AddContactRuntime()

    async with _session_local_factory()() as session:
        job = (
            await session.execute(select(AgentJob).where(AgentJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            bound_logger.warning("agent_job_missing")
            return
        if job.status in {JOB_STATUS_COMPLETED, JOB_STATUS_ABORTED}:
            bound_logger.info("agent_job_skipped", status=job.status)
            return
        if job.status in {JOB_STATUS_PENDING, JOB_STATUS_QUEUED, JOB_STATUS_ENQUEUE_FAILED}:
            job.status = JOB_STATUS_RUNNING
            await session.commit()

        try:
            client = await session_manager.get_client(agent_id)
            try:
                agent = (
                    await session.execute(select(Agent).where(Agent.id == agent_id))
                ).scalar_one_or_none()
                if agent is None:
                    bound_logger.warning("agent_missing")
                    return
                handled = False
                if job.job_type == "automation_task":
                    handled = await runtime.execute(
                        client=client, agent=agent, job=job, session=session
                    )
                    if handled:
                        await _set_job_state(session, job_id, JOB_STATUS_COMPLETED)
                elif job.job_type == GROUP_MEMBER_BROADCAST_JOB_TYPE:
                    broadcast_payload = dict(job.job_payload or {})
                    broadcast_payload["job_id"] = job.id
                    broadcast_payload["campaign_id"] = job.campaign_id
                    existing_progress = broadcast_payload.get("progress")
                    if existing_progress and existing_progress.get("sent_users"):
                        sent_count = len(existing_progress.get("sent_users", []))
                        last_checkpoint = existing_progress.get("last_checkpoint_at")
                        bound_logger.info(
                            "agent_job_resuming_from_checkpoint",
                            sent_count=sent_count,
                            last_checkpoint_at=last_checkpoint,
                        )
                    result = await broadcast_runtime.execute(
                        client=client, agent=agent, payload=broadcast_payload, session=session
                    )
                    progress = result.pop("_progress", None) if isinstance(result, dict) else None
                    if progress:
                        broadcast_payload["progress"] = {
                            "total_count": progress.get("total_count", 0),
                            "success_count": progress.get("success_count", 0),
                            "failure_count": progress.get("failure_count", 0),
                            "skipped_count": progress.get("skipped_count", 0),
                            "sent_users": progress.get("sent_users", []),
                            "failures": progress.get("failures", []),
                            "stopped_at": progress.get("stopped_at"),
                            "stop_reason": progress.get("stop_reason"),
                            "last_checkpoint_at": progress.get("last_checkpoint_at"),
                            "target_type": progress.get("target_type")
                            or result.get("target_type", "members"),
                        }
                        if progress.get("stopped_at") is not None:
                            delay_sec = max(int(progress.get("retry_after", 60)), 5)
                            broadcast_payload["progress"]["retry_after"] = delay_sec
                            job.job_payload = broadcast_payload
                            await session.commit()
                            execute_agent_job.send_with_options(
                                args=(agent_id, job_id), delay=delay_sec * 1000
                            )
                            bound_logger.info(
                                "agent_broadcast_partial_rescheduled",
                                agent_id=agent_id,
                                job_id=job_id,
                                sent=progress.get("success_count", 0),
                                reason=progress.get("stop_reason"),
                            )
                            handled = True
                            return
                    if progress:
                        broadcast_payload["result"] = result
                        job.job_payload = broadcast_payload
                        job.status = JOB_STATUS_COMPLETED
                        await session.commit()
                    else:
                        await _set_job_state(session, job_id, JOB_STATUS_COMPLETED, result=result)
                    await _create_job_notification(
                        session, job, status=JOB_STATUS_COMPLETED, result=result
                    )
                    handled = True
                elif job.job_type == ADD_CONTACT_JOB_TYPE:
                    result = await contact_runtime.execute(
                        client=client, agent=agent, payload=dict(job.job_payload or {})
                    )
                    await _set_job_state(session, job_id, JOB_STATUS_COMPLETED, result=result)
                    handled = True
                elif job.job_type == "send_lead_message":
                    result = await _handle_send_lead_message(
                        client=client, session=session, job=job
                    )
                    await _set_job_state(session, job_id, JOB_STATUS_COMPLETED, result=result)
                    handled = True
                elif job.job_type in {
                    SCRAPER_GROUP_INFO_JOB_TYPE,
                    SCRAPER_MEMBERS_JOB_TYPE,
                    SCRAPER_MESSAGES_JOB_TYPE,
                    SCRAPER_FULL_GROUP_JOB_TYPE,
                }:
                    result = await scraper_runtime.execute(
                        client=None,
                        agent=agent,
                        payload=dict(job.job_payload or {}),
                        job_type=job.job_type,
                    )
                    await _set_job_state(session, job_id, JOB_STATUS_COMPLETED, result=result)
                    if job.job_type in {SCRAPER_MEMBERS_JOB_TYPE, SCRAPER_FULL_GROUP_JOB_TYPE}:
                        await _try_auto_broadcast_dispatch(
                            session=session,
                            agent=agent,
                            job_payload=dict(job.job_payload or {}),
                            bound_logger=bound_logger,
                        )
                    handled = True
                if not handled:
                    await _set_job_state(
                        session,
                        job_id,
                        JOB_STATUS_FAILED,
                        error=f"Unhandled job type: {job.job_type}",
                    )
                    bound_logger.warning("agent_job_unhandled", job_type=job.job_type)
                    return
            finally:
                await client.disconnect()
        except AgentFloodWaitError as exc:
            await session_manager.mark_flood_wait(agent_id, exc.retry_after)
            await _set_job_state(
                session,
                job_id,
                JOB_STATUS_PENDING,
                error=f"Flood wait for {exc.retry_after} seconds",
            )
            bound_logger.warning("agent_job_flood_wait", retry_after=exc.retry_after)
            execute_agent_job.send_with_options(
                args=(agent_id, job_id), delay=exc.retry_after * 1000
            )
            return
        except AgentSessionError as exc:
            if isinstance(exc, AgentSessionRevokedError):
                await session_manager.mark_failed(agent_id)
            await _set_job_state(session, job_id, JOB_STATUS_FAILED, error=str(exc))
            bound_logger.warning("agent_job_session_failed", error=str(exc))
            return
        except AgentBannedError:
            await session_manager.mark_banned(agent_id)
            agent = (
                await session.execute(select(Agent).where(Agent.id == agent_id))
            ).scalar_one_or_none()
            if agent is not None:
                agent.status = "banned"
                agent.auth_state = "banned"
                await session.commit()
            await _set_job_state(
                session, job_id, JOB_STATUS_FAILED, error="Agent account is banned"
            )
            bound_logger.critical("agent_job_banned")
            return
        except Exception as exc:
            if final_attempt:
                await _set_job_state(session, job_id, JOB_STATUS_FAILED, error=str(exc))
            bound_logger.exception("agent_job_failed")
            raise

    bound_logger.info("agent_job_succeeded")


@dramatiq.actor(queue_name="agent", max_retries=3, min_backoff=5000, time_limit=86_400_000)
async def execute_agent_job(agent_id: int, job_id: int) -> None:
    await _execute_agent_job_impl(agent_id, job_id)


@dramatiq.actor(queue_name="scraper", max_retries=3, min_backoff=5000, time_limit=86_400_000)
async def build_conversations_actor(
    scraped_group_id: int,
    tg_group_id: int,
    first_id: int,
    last_id: int,
) -> None:
    async with SessionLocal() as session:
        try:
            rows = (
                (
                    await session.execute(
                        select(
                            ScrapedMessage.message_id,
                            ScrapedMessage.sender_user_id,
                            ScrapedMessage.sender_username,
                            ScrapedMessage.sender_first_name,
                            ScrapedMessage.sender_last_name,
                            ScrapedMessage.message_text,
                            ScrapedMessage.message_date,
                            ScrapedMessage.message_type,
                            ScrapedMessage.reply_to_message_id,
                            ScrapedMessage.reply_to_top_id,
                        ).where(
                            ScrapedMessage.scraped_group_id == scraped_group_id,
                            ScrapedMessage.message_id >= first_id,
                            ScrapedMessage.message_id <= last_id,
                        )
                    )
                )
                .mappings()
                .all()
            )

            message_rows = [dict(r) for r in rows]

            await build_conversations_from_scrape(
                session,
                scraped_group_id=scraped_group_id,
                tg_group_id=tg_group_id,
                message_rows=message_rows,
            )

            await session.commit()
        except Exception:
            await session.rollback()
            raise
