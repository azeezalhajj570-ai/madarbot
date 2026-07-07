"""Telethon-based agent execution runtime."""

from __future__ import annotations

import asyncio
from typing import Any

from aiogram import Bot
from dramatiq.message import Message
import structlog
from sqlalchemy import select

from bot.agents.exceptions import AgentBannedError, AgentFloodWaitError
from bot.agents.jobs import (
    ADD_CONTACT_JOB_TYPE,
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    JOB_STATUS_ABORTED,
    SCRAPER_FULL_GROUP_JOB_TYPE,
    SCRAPER_GROUP_INFO_JOB_TYPE,
    SCRAPER_MEMBERS_JOB_TYPE,
    SCRAPER_MESSAGES_JOB_TYPE,
    get_interval_for_contact,
    normalize_group_member_broadcast_payload,
)
from bot.automation.agent_task_store import AgentTaskStore
from bot.automation.models import TaskEvent
from bot.automation.registry import Registry
from bot.config import get_settings
from bot.agents.rpc_wrapper import (
    call_with_retry,
    check_agent_health,
    iter_participants_with_timeout,
    send_file_with_timeout,
)
from bot.db.models import Agent, AgentJob, ScrapedMember
from bot.db.session import SessionLocal
from bot.utils.rate_limiter import AgentRateLimiter
from bot.services.notify_destination_approval_service import NotifyDestinationApprovalService
from bot.services.task_activity_service import TaskActivityService
from bot.workers.app import redis_broker

__all__ = [
    "ADD_CONTACT_JOB_TYPE",
    "GROUP_MEMBER_BROADCAST_JOB_TYPE",
    "SCRAPER_FULL_GROUP_JOB_TYPE",
    "SCRAPER_GROUP_INFO_JOB_TYPE",
    "SCRAPER_MEMBERS_JOB_TYPE",
    "SCRAPER_MESSAGES_JOB_TYPE",
    "AddContactRuntime",
    "GroupMemberBroadcastRuntime",
    "ScraperRuntime",
    "UserAgentExecutor",
]

logger = structlog.get_logger(__name__)


def _translate_client_exception(exc: Exception) -> Exception | None:
    try:
        from telethon.errors import FloodWaitError
        from telethon.errors.rpcerrorlist import (
            PeerFloodError,
            PhoneNumberBannedError,
            UserDeactivatedBanError,
        )

        if isinstance(exc, FloodWaitError):
            return AgentFloodWaitError(retry_after=exc.seconds)
        if isinstance(exc, PeerFloodError):
            return AgentFloodWaitError(retry_after=3600)
        if isinstance(exc, (PhoneNumberBannedError, UserDeactivatedBanError)):
            return AgentBannedError()
    except ImportError:
        pass
    return None


_SEND_TIMEOUT_SECONDS = 60


async def send_message_with_timeout(client, *args, **kwargs):
    try:
        return await call_with_retry(
            client,
            lambda: client.send_message(*args, **kwargs),
            rpc_name="send_message",
            timeout=_SEND_TIMEOUT_SECONDS,
            max_retries=0,
        )
    except (asyncio.TimeoutError, TimeoutError):
        raise TimeoutError(f"send_message timed out after {_SEND_TIMEOUT_SECONDS}s")


class UserAgentExecutor:
    def __init__(self, *, bot: Bot | None = None) -> None:
        self.bot = bot

    async def execute(self, *, client, payload: dict[str, Any]) -> bool:
        chat_id = payload.get("chat_id") or payload.get("group_id")
        text = payload.get("text", "")
        if not chat_id or not text:
            return False
        try:
            await send_message_with_timeout(client, int(chat_id), str(text))
            return True
        except Exception:
            return False

    async def run(self, *, agent: Agent, job: AgentJob, registry: Registry, session: Any) -> bool:
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        settings = get_settings()
        if not settings.telegram_api_id or not settings.telegram_api_hash:
            return False

        managed_client = TelegramClient(
            StringSession(agent.session_string),
            settings.telegram_api_id,
            settings.telegram_api_hash,
        )
        await managed_client.connect()
        try:
            task_store = AgentTaskStore(session)
            activity_service = TaskActivityService(session)
            approval_service = NotifyDestinationApprovalService(session)
            runtime = AgentTaskRuntime(
                registry=registry,
                task_store=task_store,
                activity_service=activity_service,
                approval_service=approval_service,
            )
            return await runtime.execute(
                client=managed_client, agent=agent, job=job, session=session
            )
        finally:
            await managed_client.disconnect()


class AddContactRuntime:
    async def resolve_group_entity(self, client, tg_group_id: int) -> Any:
        from bot.services.group_service import canonical_tg_group_id
        from bot.db.models import ScrapedGroup
        from telethon.tl.types import InputPeerChannel, InputPeerChat

        canonical_id = canonical_tg_group_id(tg_group_id)
        try:
            return await call_with_retry(
                client,
                lambda: client.get_entity(tg_group_id),
                rpc_name="get_entity",
            )
        except Exception:
            async with SessionLocal() as session:
                stmt = select(ScrapedGroup).where(ScrapedGroup.tg_group_id == canonical_id).limit(1)
                group_record = (await session.execute(stmt)).scalar_one_or_none()
                if group_record and group_record.raw_data:
                    g_access_hash = group_record.raw_data.get("access_hash")
                    if g_access_hash:
                        if group_record.group_type in {"channel", "supergroup"}:
                            return await call_with_retry(
                                client,
                                lambda: client.get_entity(
                                    InputPeerChannel(
                                        channel_id=abs(canonical_id) % (10**10)
                                        if canonical_id < -(10**12)
                                        else abs(canonical_id),
                                        access_hash=int(g_access_hash),
                                    )
                                ),
                                rpc_name="get_entity",
                            )
                        else:
                            return await call_with_retry(
                                client,
                                lambda: client.get_entity(InputPeerChat(chat_id=abs(canonical_id))),
                                rpc_name="get_entity",
                            )
            raise

    async def execute(self, *, client, agent: Agent, payload: dict[str, Any]) -> dict[str, Any]:
        user_id = payload.get("user_id")
        if not user_id:
            raise ValueError("user_id is required to add contact")

        user_id_int = int(user_id)
        if user_id_int < 0:
            raise ValueError(
                f"Invalid user_id {user_id}: Cannot add a group or channel as a contact."
            )

        username = payload.get("username")
        tg_group_id = payload.get("tg_group_id")
        group_title = str(payload.get("group_title") or "Group").strip()

        # Implementation of naming convention: [Suffix] [GroupID] [GroupName] - [Name]
        agent_phone = str(agent.phone_number or "NoPhone").strip()
        phone_suffix = agent_phone[-4:] if len(agent_phone) >= 4 else agent_phone

        raw_first_name = str(payload.get("first_name") or "User").strip()
        raw_last_name = str(payload.get("last_name") or "").strip()

        # Build prefix components
        prefix_parts = [phone_suffix]
        if tg_group_id:
            prefix_parts.append(str(tg_group_id))
        if group_title and group_title != "Group":
            prefix_parts.append(group_title)

        first_name = f"{' '.join(prefix_parts)} -"
        last_name = f"{raw_first_name} {raw_last_name}".strip()

        # Prime the cache to avoid "Could not find the input entity"
        target_peer = None

        # 1. Try by username
        if username:
            try:
                target_peer = await client.get_input_entity(str(username))
            except Exception:
                logger.warning("add_contact_prime_username_failed", username=username)

        # 2. Try database-backed access hash (Persistent fallback)
        if target_peer is None:
            from telethon.tl.types import InputPeerUser

            async with SessionLocal() as session:
                # Prefer records with access_hash
                stmt = (
                    select(ScrapedMember)
                    .where(ScrapedMember.tg_user_id == user_id_int)
                    .order_by(ScrapedMember.scraped_at.desc())
                )
                results = (await session.execute(stmt)).scalars().all()
                member_record = next((r for r in results if r.raw_data.get("access_hash")), None)
                if not member_record and results:
                    member_record = results[0]

                if member_record and member_record.raw_data:
                    access_hash = member_record.raw_data.get("access_hash")
                    if access_hash:
                        target_peer = InputPeerUser(
                            user_id=user_id_int, access_hash=int(access_hash)
                        )

        # 3. Try official group fetching (Chat context priming)
        if target_peer is None and tg_group_id:
            try:
                group_entity = await self.resolve_group_entity(client, int(tg_group_id))
                if group_entity:
                    # Search for the user in this group to prime the cache
                    async for u in iter_participants_with_timeout(
                        client, group_entity, search=str(user_id_int)
                    ):
                        if u.id == user_id_int:
                            target_peer = await client.get_input_entity(u)
                            break
            except Exception as exc:
                logger.warning(
                    "add_contact_prime_group_failed",
                    user_id=user_id_int,
                    tg_group_id=tg_group_id,
                    error=str(exc),
                )

        # 4. Fallback to direct resolution
        if target_peer is None:
            try:
                target_peer = await client.get_input_entity(user_id_int)
            except Exception:
                # Absolute last resort: try a global entity fetch
                try:
                    target_peer = await call_with_retry(
                        client,
                        lambda: client.get_entity(user_id_int),
                        rpc_name="get_entity",
                    )
                except Exception:
                    raise ValueError(
                        f"Could not resolve user {user_id_int}. Try syncing the workspace or scraping again."
                    )

        from telethon.tl.types import InputPeerUser, InputUser, InputPeerSelf
        from telethon.tl.functions.contacts import AddContactRequest

        # Final type safety check: only users can be added as contacts
        is_user = isinstance(target_peer, (InputPeerUser, InputUser, InputPeerSelf)) or (
            isinstance(target_peer, int) and target_peer > 0
        )
        if not is_user:
            raise ValueError(
                f"Entity {user_id_int} is not a valid Telegram user and cannot be added to contacts."
            )

        try:
            await client(
                AddContactRequest(
                    id=target_peer,
                    first_name=first_name,
                    last_name=last_name,
                    phone=str(payload.get("phone") or "").strip(),
                    add_phone_privacy_exception=True,
                )
            )
            return {
                "user_id": user_id_int,
                "first_name": first_name,
                "last_name": last_name,
                "success": True,
            }
        except Exception as exc:
            translated = _translate_client_exception(exc)
            if translated is not None:
                raise translated from exc
            raise


async def _resolve_selected_recipients(
    *,
    client,
    agent: Agent,
    session,
    user_ids: list[int],
    recipients: list[int],
    resolved_peers: dict[int, Any],
    recipient_identities: dict[int, dict[str, str | None]],
    skip_bots: bool = True,
) -> None:
    from telethon.tl.types import InputPeerUser

    db_identities: dict[int, dict[str, Any]] = {}
    if session is not None and user_ids:
        member_rows = (
            (
                await session.execute(
                    select(ScrapedMember).where(
                        ScrapedMember.tg_user_id.in_(user_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in member_rows:
            uid = int(row.tg_user_id)
            if not row.raw_data:
                continue
            existing = db_identities.get(uid)
            has_access_hash = bool(row.raw_data.get("access_hash"))
            if existing is None or (has_access_hash and not existing.get("access_hash")):
                db_identities[uid] = dict(row.raw_data)

    for uid in user_ids:
        if uid == agent.telegram_user_id:
            continue

        raw = db_identities.get(uid, {})
        peer = None

        if skip_bots and bool(raw.get("bot", False)):
            logger.warning("broadcast_skip_bot", user_id=uid)
            continue

        try:
            peer = await client.get_input_entity(uid)
        except Exception:
            try:
                await client.get_entity(uid)
                peer = await client.get_input_entity(uid)
            except Exception:
                access_hash = raw.get("access_hash")
                if access_hash:
                    try:
                        peer = InputPeerUser(user_id=uid, access_hash=int(access_hash))
                    except Exception:
                        pass

        if peer is None:
            logger.warning(
                "broadcast_resolve_user_failed",
                user_id=uid,
            )
            continue

        resolved_peers[uid] = peer

        username = raw.get("username")
        phone = raw.get("phone")
        if username or phone:
            recipient_identities[uid] = {
                "phone": str(phone).strip() if phone else None,
                "username": str(username).strip().lower() if username else None,
            }

        recipients.append(uid)


class GroupMemberBroadcastRuntime:
    def __init__(self, *, sleep=asyncio.sleep) -> None:
        self.sleep = sleep

    async def execute(
        self, *, client, agent: Agent, payload: dict[str, Any], session=None
    ) -> dict[str, Any]:
        import random
        import hashlib
        from datetime import datetime, timedelta, timezone
        from bot.config import get_settings
        from bot.utils.rate_limiter import AgentRateLimiter
        from bot.db.models.agent import SentBroadcastMessage, AgentJob
        from bot.db.models.bulk_messaging import AgentBlacklistEntry
        from redis.asyncio import Redis
        from sqlalchemy import or_, select

        normalized = normalize_group_member_broadcast_payload(payload)

        campaign_id: int | None = payload.get("campaign_id")

        redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)
        limiter = AgentRateLimiter(redis_client)
        try:
            target_type = normalized["target_type"]
            messages: list[str] = normalized["messages"]
            media_urls: list[str | None] = list(normalized.get("media_urls") or [])
            threshold = int(normalized.get("threshold") or 0)
            base_interval = float(normalized.get("interval_seconds") or 2.0)
            contact_interval = float(normalized.get("interval_between_contacts") or base_interval)
            interval_strategy = (
                str(normalized.get("interval_strategy") or "graduated").strip().lower()
            )

            progress = dict(payload.get("progress") or {})
            already_sent: set[int] = set(int(uid) for uid in progress.get("sent_users", []))
            skipped_count = len(already_sent)
            success_count = progress.get("success_count", 0)
            failure_count = progress.get("failure_count", 0)
            failures: list[dict[str, Any]] = list(progress.get("failures", []))
            last_checkpoint_at = progress.get("last_checkpoint_at")
            checkpoint_send_count = 0

            if target_type == "groups":
                result = await self._execute_groups_mode(
                    client=client,
                    agent=agent,
                    normalized=normalized,
                    messages=messages,
                    media_urls=media_urls,
                    threshold=threshold,
                    base_interval=base_interval,
                    contact_interval=contact_interval,
                    progress=progress,
                    payload=payload,
                    limiter=limiter,
                    already_sent=already_sent,
                    skipped_count=skipped_count,
                    success_count=success_count,
                    failure_count=failure_count,
                    failures=failures,
                    session=session,
                    campaign_id=campaign_id,
                )
                return result

            source_group_id = int(normalized["source_group_id"])
            selected_user_ids = {int(uid) for uid in normalized.get("selected_user_ids", [])}

            await check_agent_health(client)

            recipients: list[int] = []
            resolved_peers: dict[int, Any] = {}
            recipient_identities: dict[int, dict[str, str | None]] = {}
            group_entity = await AddContactRuntime().resolve_group_entity(
                client, source_group_id
            )
            async for participant in iter_participants_with_timeout(client, group_entity):
                pid = getattr(participant, "id", None)
                if pid is None:
                    continue
                if bool(normalized.get("skip_bots", True)) and bool(
                    getattr(participant, "bot", False)
                ):
                    continue
                if bool(getattr(participant, "deleted", False)):
                    continue
                if agent.telegram_user_id is not None and int(pid) == int(agent.telegram_user_id):
                    continue
                if selected_user_ids and int(pid) not in selected_user_ids:
                    continue
                uid = int(pid)
                recipients.append(uid)
                participant_phone = getattr(participant, "phone", None)
                participant_username = getattr(participant, "username", None)
                if participant_phone or participant_username:
                    recipient_identities[uid] = {
                        "phone": str(participant_phone).strip() if participant_phone else None,
                        "username": str(participant_username).strip().lower()
                        if participant_username
                        else None,
                    }

            recipients_set = set(recipients)
            recipients = [r for r in recipients if r not in already_sent]
            total_selected = len(selected_user_ids) if selected_user_ids else len(recipients_set)
            total_count = len(recipients_set)

            message_hash = hashlib.sha256(
                "||".join(m.lower().strip() for m in messages).encode()
            ).hexdigest()
            dedup_skip_count = 0
            recently_sent: set[int] = set()
            if session is not None:
                seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
                phones = [v["phone"] for v in recipient_identities.values() if v.get("phone")]
                usernames = [
                    v["username"] for v in recipient_identities.values() if v.get("username")
                ]
                identity_filters = [SentBroadcastMessage.tg_user_id.in_(recipients)]
                if phones:
                    identity_filters.append(SentBroadcastMessage.phone_number.in_(phones))
                if usernames:
                    identity_filters.append(SentBroadcastMessage.username.in_(usernames))
                result = await session.execute(
                    select(SentBroadcastMessage.tg_user_id).where(
                        SentBroadcastMessage.agent_id == agent.id,
                        SentBroadcastMessage.tg_group_id == source_group_id,
                        SentBroadcastMessage.message_hash == message_hash,
                        SentBroadcastMessage.sent_at >= seven_days_ago,
                        SentBroadcastMessage.status.in_(["sent", "pending"]),
                        or_(*identity_filters),
                    )
                )
                recently_sent = {row[0] for row in result if row[0] is not None}
            filtered = [r for r in recipients if r not in recently_sent]
            dedup_skip_count = len(recipients) - len(filtered)
            recipients = filtered

            remaining = recipients[:threshold] if threshold > 0 else recipients
            payload["progress"] = {
                "total_count": total_count,
                "success_count": success_count,
                "failure_count": failure_count,
                "skipped_count": skipped_count + dedup_skip_count,
                "dedup_skipped": dedup_skip_count,
                "sent_users": list(already_sent),
                "failures": failures,
                "last_checkpoint_at": last_checkpoint_at or datetime.now(timezone.utc).isoformat(),
            }

            if session is not None:
                bl_stmt = select(AgentBlacklistEntry).where(
                    AgentBlacklistEntry.agent_id == agent.id
                )
                bl_rows = (await session.execute(bl_stmt)).scalars().all()
                blacklist_tg_ids = {int(e.tg_user_id) for e in bl_rows if e.tg_user_id is not None}
                blacklist_usernames = {e.username.strip().lower() for e in bl_rows if e.username}
                blacklist_phones = {e.phone.strip() for e in bl_rows if e.phone}
            else:
                blacklist_tg_ids = set()
                blacklist_usernames = set()
                blacklist_phones = set()

            blacklist_skipped = 0
            for index, recipient_id in enumerate(remaining):
                cooldown_mins = getattr(agent, "cooldown_minutes", None)
                if cooldown_mins is not None and cooldown_mins > 0:
                    in_cooldown, cd_remaining = await limiter.is_in_cooldown(
                        agent.id, cooldown_mins
                    )
                    if in_cooldown:
                        payload["progress"]["stopped_at"] = index
                        payload["progress"]["stop_reason"] = "cooldown"
                        payload["progress"]["retry_after"] = int(cd_remaining)
                        raise _translate_client_exception(
                            Exception(f"Agent cooldown: {cd_remaining}s")
                        ) or Exception(f"Cooldown: {cd_remaining}s")

                max_per_hour = getattr(agent, "max_actions_per_hour", None)
                if max_per_hour is not None and max_per_hour > 0:
                    allowed, hour_count = await limiter.check_and_increment(agent.id, max_per_hour)
                    if not allowed:
                        payload["progress"]["stopped_at"] = index
                        payload["progress"]["stop_reason"] = "hourly_limit"
                        raise Exception(f"Hourly limit reached ({hour_count}/{max_per_hour})")

                max_per_day = getattr(agent, "max_messages_per_day", None) or 500

                min_delay = getattr(agent, "min_delay_seconds", None)
                if min_delay is not None and min_delay > 0:
                    wait = await limiter.enforce_delay(agent.id, float(min_delay))
                    if wait > 0:
                        await self.sleep(wait)

                identity = recipient_identities.get(recipient_id, {})
                id_phone = (identity.get("phone") or "").strip().lower()
                id_username = (identity.get("username") or "").strip().lower()

                if recipient_id in blacklist_tg_ids:
                    blacklist_skipped += 1
                    skipped_count += 1
                    continue
                if id_username and id_username in blacklist_usernames:
                    blacklist_skipped += 1
                    skipped_count += 1
                    continue
                if id_phone and id_phone in blacklist_phones:
                    blacklist_skipped += 1
                    skipped_count += 1
                    continue

                if max_per_day > 0:
                    allowed, day_count = await limiter.check_daily_limit(
                        agent.id, max_per_day, recipient_id
                    )
                    if not allowed:
                        payload["progress"]["stopped_at"] = index
                        payload["progress"]["stop_reason"] = "daily_limit"
                        raise Exception(
                            f"Daily unique contact limit reached ({day_count}/{max_per_day})"
                        )

                pending_record = None
                try:
                    # Insert pending record BEFORE sending — if we crash after this,
                    # the dedup query catches it and prevents duplicate sends on retry.
                    if session is not None:
                        identity = recipient_identities.get(recipient_id, {})
                        pending_record = SentBroadcastMessage(
                            agent_id=agent.id,
                            campaign_id=campaign_id,
                            job_id=payload.get("job_id"),
                            tg_user_id=recipient_id,
                            phone_number=identity.get("phone"),
                            username=identity.get("username"),
                            message_id=None,
                            tg_chat_id=recipient_id,
                            tg_group_id=source_group_id,
                            message_text="\n\n".join(messages),
                            message_hash=message_hash,
                            status="pending",
                            sent_at=datetime.now(timezone.utc),
                            created_at=datetime.now(timezone.utc),
                        )
                        session.add(pending_record)
                        await session.commit()

                    sent_msg = None
                    target_peer = resolved_peers.get(recipient_id, recipient_id)
                    for mi, msg in enumerate(messages):
                        media_url = media_urls[mi] if mi < len(media_urls) else None
                        if media_url:
                            sent_msg = await send_file_with_timeout(
                                client, target_peer, msg, media_url
                            )
                        else:
                            sent_msg = await send_message_with_timeout(client, target_peer, msg)
                        if mi < len(messages) - 1 and base_interval > 0:
                            jitter = random.uniform(-0.3, 0.3) * base_interval
                            msg_interval = max(0.3, base_interval + jitter)
                            await self.sleep(msg_interval)
                    success_count += 1
                    already_sent.add(recipient_id)
                    checkpoint_send_count += 1

                    if pending_record is not None:
                        pending_record.status = "sent"
                        pending_record.message_id = sent_msg.id if sent_msg else None
                        await session.commit()

                    await limiter.record_send(agent.id, recipient_id)

                    should_checkpoint = (
                        checkpoint_send_count >= 10
                        or last_checkpoint_at is None
                        or (
                            datetime.now(timezone.utc) - datetime.fromisoformat(last_checkpoint_at)
                        ).total_seconds()
                        >= 60
                    )
                    if should_checkpoint and session is not None:
                        last_checkpoint_at = datetime.now(timezone.utc).isoformat()
                        payload["progress"] = {
                            "total_count": total_count,
                            "success_count": success_count,
                            "failure_count": failure_count,
                            "skipped_count": skipped_count + dedup_skip_count,
                            "dedup_skipped": dedup_skip_count,
                            "sent_users": list(already_sent),
                            "failures": failures,
                            "last_checkpoint_at": last_checkpoint_at,
                        }
                        job_obj = (
                            await session.execute(
                                select(AgentJob).where(AgentJob.id == payload.get("job_id"))
                            )
                            if payload.get("job_id")
                            else None
                        )
                        if job_obj is not None:
                            job_record = job_obj.scalar_one_or_none()
                            if job_record is not None:
                                job_record.job_payload = dict(payload)
                                await session.commit()
                        checkpoint_send_count = 0
                except Exception as exc:
                    failure_count += 1
                    if pending_record is not None:
                        pending_record.status = "failed"
                        await session.commit()
                    translated = _translate_client_exception(exc)
                    if translated is not None:
                        payload["progress"]["stopped_at"] = index
                        payload["progress"]["stop_reason"] = type(translated).__name__
                        payload["progress"]["sent_users"] = list(already_sent)
                        payload["progress"]["success_count"] = success_count
                        payload["progress"]["failure_count"] = failure_count
                        raise translated from exc
                    failures.append({"user_id": str(recipient_id), "error": str(exc)[:200]})

                effective_interval = get_interval_for_contact(
                    success_count, interval_strategy, contact_interval
                )
                if effective_interval > 0:
                    jitter = random.uniform(-0.1, 0.1) * effective_interval
                    effective_interval = max(0.3, effective_interval + jitter)
                logger.info(
                    "broadcast_interval",
                    strategy=interval_strategy,
                    contact_interval=contact_interval,
                    success_count=success_count,
                    effective_interval=round(effective_interval, 1),
                    index=index,
                    total=len(remaining),
                )
                if index % 5 == 0 and session is not None and payload.get("job_id"):
                    job_check = await session.execute(
                        select(AgentJob).where(AgentJob.id == payload["job_id"])
                    )
                    job_row = job_check.scalar_one_or_none()
                    if job_row is not None and job_row.status == JOB_STATUS_ABORTED:
                        logger.info("broadcast_aborted_detected", job_id=payload["job_id"])
                        raise Exception("Job aborted by user")

                if index < len(remaining) - 1 and effective_interval > 0:
                    await self.sleep(effective_interval)

            return {
                "success_count": success_count,
                "failure_count": failure_count,
                "total_count": total_count,
                "total_selected": total_selected,
                "skipped_already_sent": skipped_count,
                "dedup_skipped": dedup_skip_count,
                "failures": failures,
                "_progress": dict(payload.get("progress") or {}),
                "target_type": "members",
            }
        finally:
            await redis_client.aclose()

    async def _execute_groups_mode(
        self,
        *,
        client,
        agent,
        normalized,
        messages,
        media_urls,
        threshold,
        base_interval,
        contact_interval,
        progress,
        payload,
        limiter,
        already_sent,
        skipped_count,
        success_count,
        failure_count,
        failures,
        session,
        campaign_id,
    ) -> dict[str, Any]:
        import random
        import hashlib
        from datetime import datetime, timezone
        from bot.db.models.agent import SentBroadcastMessage

        target_group_ids = list(normalized.get("target_group_ids", []))
        total_count = len(target_group_ids)

        remaining = target_group_ids[:threshold] if threshold > 0 else target_group_ids
        payload["progress"] = {
            "total_count": total_count,
            "success_count": success_count,
            "failure_count": failure_count,
            "skipped_count": skipped_count,
            "sent_users": list(already_sent),
            "failures": failures,
        }

        message_hash = hashlib.sha256(
            "||".join(m.lower().strip() for m in messages).encode()
        ).hexdigest()

        for index, group_id in enumerate(remaining):
            cooldown_mins = getattr(agent, "cooldown_minutes", None)
            if cooldown_mins is not None and cooldown_mins > 0:
                in_cooldown, cd_remaining = await limiter.is_in_cooldown(agent.id, cooldown_mins)
                if in_cooldown:
                    payload["progress"]["stopped_at"] = index
                    payload["progress"]["stop_reason"] = "cooldown"
                    payload["progress"]["retry_after"] = int(cd_remaining)
                    raise Exception(f"Agent cooldown: {cd_remaining}s")

            max_per_hour = getattr(agent, "max_actions_per_hour", None)
            if max_per_hour is not None and max_per_hour > 0:
                allowed, hour_count = await limiter.check_and_increment(agent.id, max_per_hour)
                if not allowed:
                    payload["progress"]["stopped_at"] = index
                    payload["progress"]["stop_reason"] = "hourly_limit"
                    raise Exception(f"Hourly limit reached ({hour_count}/{max_per_hour})")

            max_per_day = getattr(agent, "max_messages_per_day", None) or 500
            if max_per_day > 0:
                allowed, day_count = await limiter.check_daily_limit(agent.id, max_per_day)
                if not allowed:
                    payload["progress"]["stopped_at"] = index
                    payload["progress"]["stop_reason"] = "daily_limit"
                    raise Exception(f"Daily limit reached ({day_count}/{max_per_day})")

            min_delay = getattr(agent, "min_delay_seconds", None)
            if min_delay is not None and min_delay > 0:
                wait = await limiter.enforce_delay(agent.id, float(min_delay))
                if wait > 0:
                    await self.sleep(wait)

            pending_record = None
            try:
                # Insert pending record BEFORE sending
                if session is not None:
                    pending_record = SentBroadcastMessage(
                        agent_id=agent.id,
                        campaign_id=campaign_id,
                        job_id=payload.get("job_id"),
                        tg_user_id=None,
                        tg_group_id=group_id,
                        message_text="\n\n".join(messages),
                        message_hash=message_hash,
                        status="pending",
                        sent_at=datetime.now(timezone.utc),
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(pending_record)
                    await session.commit()

                for mi, msg in enumerate(messages):
                    media_url = media_urls[mi] if mi < len(media_urls) else None
                    if media_url:
                        await send_file_with_timeout(client, group_id, msg, media_url)
                    else:
                        await send_message_with_timeout(client, group_id, msg)
                    if mi < len(messages) - 1 and base_interval > 0:
                        jitter = random.uniform(-0.3, 0.3) * base_interval
                        msg_interval = max(0.3, base_interval + jitter)
                        await self.sleep(msg_interval)
                success_count += 1
                already_sent.add(group_id)
                payload["progress"]["success_count"] = success_count

                if pending_record is not None:
                    pending_record.status = "sent"
                    await session.commit()

                await limiter.record_send(agent.id)
            except Exception as exc:
                failure_count += 1
                payload["progress"]["failure_count"] = failure_count
                payload["progress"]["sent_users"] = list(already_sent)
                if pending_record is not None:
                    pending_record.status = "failed"
                    await session.commit()
                translated = _translate_client_exception(exc)
                if translated is not None:
                    payload["progress"]["stopped_at"] = index
                    payload["progress"]["stop_reason"] = type(translated).__name__
                    payload["progress"]["success_count"] = success_count
                    payload["progress"]["failure_count"] = failure_count
                    raise translated from exc
                failures.append({"group_id": str(group_id), "error": str(exc)[:200]})

            effective_interval = get_interval_for_contact(success_count, "fixed", contact_interval)
            if effective_interval > 0:
                jitter = random.uniform(-0.1, 0.1) * effective_interval
                effective_interval = max(0.3, effective_interval + jitter)
            if index % 5 == 0 and session is not None and payload.get("job_id"):
                job_check = await session.execute(
                    select(AgentJob).where(AgentJob.id == payload["job_id"])
                )
                job_row = job_check.scalar_one_or_none()
                if job_row is not None and job_row.status == JOB_STATUS_ABORTED:
                    logger.info("broadcast_aborted_detected", job_id=payload["job_id"])
                    raise Exception("Job aborted by user")

            if index < len(remaining) - 1 and effective_interval > 0:
                await self.sleep(effective_interval)

        return {
            "success_count": success_count,
            "failure_count": failure_count,
            "total_count": total_count,
            "failures": failures,
            "_progress": dict(payload.get("progress") or {}),
            "target_type": "groups",
        }


class ScraperRuntime:
    async def _enqueue_conversation_jobs(self, conversation_jobs: list[dict[str, Any]]) -> None:
        if not conversation_jobs:
            return

        from redis.asyncio import Redis

        try:
            redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)
            queue_depth = await redis_client.llen("dramatiq:scraper")
            await redis_client.aclose()
            if queue_depth > 1000:
                logger.warning("conversation_queue_overloaded", depth=queue_depth)
                await asyncio.sleep(30)
        except Exception:
            pass

        for conversation_job in conversation_jobs:
            redis_broker.enqueue(
                Message(
                    queue_name="scraper",
                    actor_name="build_conversations_actor",
                    args=(
                        conversation_job["scraped_group_id"],
                        conversation_job["tg_group_id"],
                        conversation_job["first_id"],
                        conversation_job["last_id"],
                    ),
                    kwargs={},
                    options={},
                )
            )

    async def execute(
        self, *, client, agent: Agent, payload: dict[str, Any], job_type: str | None = None
    ) -> dict[str, Any]:
        from bot.services.scraper_service import ScraperService

        async with SessionLocal() as session:
            service = ScraperService(session)
            active_job_type = job_type or payload.get("job_type") or payload.get("type")
            tg_group_id = payload.get("tg_group_id")
            if not tg_group_id:
                raise ValueError("tg_group_id is required for scraper jobs")

            if active_job_type == SCRAPER_GROUP_INFO_JOB_TYPE:
                result = await service._scrape_group_info_dict(
                    agent_id=agent.id, tg_group_id=int(tg_group_id), client=client
                )
                return {
                    "job_type": active_job_type,
                    "tg_group_id": int(tg_group_id),
                    "success": result is not None,
                    "group_info": result,
                }
            elif active_job_type == SCRAPER_MEMBERS_JOB_TYPE:
                result = await service.scrape_members(
                    agent_id=agent.id,
                    tg_group_id=int(tg_group_id),
                    limit=int(payload.get("limit", payload.get("member_limit", 1000))),
                    client=client,
                )
                return {
                    "job_type": active_job_type,
                    "tg_group_id": int(tg_group_id),
                    **result,
                }
            elif active_job_type == SCRAPER_MESSAGES_JOB_TYPE:
                scan_strategy = payload.get("scan_strategy", "auto")
                message_limit = int(payload.get("limit", payload.get("message_limit", 100)))
                max_age_days = (
                    int(payload.get("max_age_days", 30)) if payload.get("max_age_days") else None
                )
                if scan_strategy == "auto":
                    scan_strategy = "checkpoint" if message_limit >= 5000 else "full"

                if scan_strategy == "checkpoint":
                    result = await service.scrape_messages_checkpointed(
                        agent_id=agent.id,
                        tg_group_id=int(tg_group_id),
                        limit=message_limit,
                        max_age_days=max_age_days,
                        checkpoint_batch_size=int(payload.get("checkpoint_batch_size", 500)),
                        client=client,
                    )
                    conv_jobs = result.pop("conversation_jobs", [])
                    await self._enqueue_conversation_jobs(conv_jobs)
                elif scan_strategy == "two_period":
                    recent_days = int(payload.get("recent_days", 30))
                    archive_days = int(payload.get("archive_days", 365))
                    result = await service.scrape_messages_two_period(
                        agent_id=agent.id,
                        tg_group_id=int(tg_group_id),
                        recent_days=recent_days,
                        archive_days=archive_days,
                        client=client,
                    )
                else:
                    result = await service.scrape_messages(
                        agent_id=agent.id,
                        tg_group_id=int(tg_group_id),
                        limit=message_limit,
                        max_age_days=max_age_days,
                        client=client,
                    )
                return {
                    "job_type": active_job_type,
                    "tg_group_id": int(tg_group_id),
                    **result,
                }
            elif active_job_type == SCRAPER_FULL_GROUP_JOB_TYPE:
                scrape_members = payload.get("scrape_members", True)
                scrape_messages = payload.get("scrape_messages", True)
                max_age_days = (
                    int(payload.get("max_age_days", 30)) if payload.get("max_age_days") else None
                )
                scan_strategy = payload.get("scan_strategy", "auto")
                result = await service.scrape_full_group(
                    agent_id=agent.id,
                    tg_group_id=int(tg_group_id),
                    scrape_members=bool(scrape_members),
                    scrape_messages=bool(scrape_messages),
                    member_limit=int(payload.get("member_limit", 1000)),
                    message_limit=int(payload.get("message_limit", 100)),
                    max_age_days=max_age_days,
                    scan_strategy=scan_strategy,
                    client=client,
                )
                messages_result = result.get("messages")
                conv_jobs = []
                if isinstance(messages_result, dict):
                    conv_jobs = messages_result.pop("conversation_jobs", [])
                await self._enqueue_conversation_jobs(conv_jobs)
                return {
                    "job_type": active_job_type,
                    "tg_group_id": int(tg_group_id),
                    "group_info": result.get("group_info"),
                    "members": result["members"],
                    "messages": result["messages"],
                }
            else:
                raise ValueError(f"Unsupported scraper job type: {active_job_type}")


class AgentTaskRuntime:
    def __init__(
        self,
        *,
        registry: Registry,
        task_store: AgentTaskStore | None = None,
        activity_service: TaskActivityService | None = None,
        approval_service: NotifyDestinationApprovalService | None = None,
    ) -> None:
        self.registry = registry
        self.task_store = task_store
        self.activity_service = activity_service
        self.approval_service = approval_service

    async def execute(self, *, client, agent: Agent, job: AgentJob, session: Any) -> bool:
        payload = dict(job.job_payload or {})
        task_key = payload.get("task_key")
        assignment_id = payload.get("assignment_id")
        event_data = payload.get("event", {})
        event_payload = event_data.get("payload", {})
        task_config = payload.get("task_config", {})

        if not task_key or not assignment_id:
            return False

        definition = self.registry.get(task_key)
        if not definition:
            return False

        try:
            event = TaskEvent(
                name=event_data.get("name") or task_key,
                group_id=event_data.get("group_id", 0),
                user_id=event_data.get("user_id"),
                payload=event_payload,
            )

            from redis.asyncio import Redis

            redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)
            limiter = AgentRateLimiter(redis_client)

            try:
                cooldown_mins = getattr(agent, "cooldown_minutes", None)
                if cooldown_mins is not None and cooldown_mins > 0:
                    in_cooldown, remaining = await limiter.is_in_cooldown(agent.id, cooldown_mins)
                    if in_cooldown:
                        logger.warning(
                            "agent_in_cooldown", agent_id=agent.id, remaining_seconds=remaining
                        )
                        return False

                safety_enabled = getattr(agent, "safety_mode_enabled", True)
                safety_until = getattr(agent, "safety_mode_until", None)
                if await limiter.check_safety_mode(agent.id, safety_enabled, safety_until):
                    logger.info(
                        "agent_in_safety_mode", agent_id=agent.id, safety_until=safety_until
                    )
                    result = await definition.handler(task_config, event)
                    if isinstance(result, dict):
                        result["_safety_mode"] = True
                    return True

                max_per_hour = (
                    task_config.get("max_actions_per_hour")
                    or payload.get("max_actions_per_hour")
                    or getattr(agent, "max_actions_per_hour", None)
                )
                if max_per_hour is not None:
                    allowed, count = await limiter.check_and_increment(agent.id, int(max_per_hour))
                    if not allowed:
                        logger.warning(
                            "agent_rate_limit_exceeded",
                            agent_id=agent.id,
                            limit=max_per_hour,
                            count=count,
                        )
                        cooldown_mins = getattr(agent, "cooldown_minutes", None)
                        if cooldown_mins is not None and cooldown_mins > 0:
                            await limiter.start_cooldown(agent.id, cooldown_mins)
                            logger.warning(
                                "agent_entered_cooldown",
                                agent_id=agent.id,
                                cooldown_minutes=cooldown_mins,
                            )
                        return False

                min_delay = (
                    task_config.get("min_delay_seconds")
                    or payload.get("min_delay_seconds")
                    or getattr(agent, "min_delay_seconds", None)
                )
                if min_delay is not None:
                    wait_seconds = await limiter.enforce_delay(agent.id, float(min_delay))
                    if wait_seconds > 0:
                        import asyncio

                        await asyncio.sleep(wait_seconds)

            finally:
                await redis_client.aclose()

            # Handle Approval Requests if present in payload
            approval_request = payload.get("approval_request")
            if isinstance(approval_request, dict):
                target_user_id = approval_request.get("target_user_id")
                if target_user_id is None:
                    raise ValueError("Approval requests require target_user_id")

                group_id = event_payload.get("group_id")
                destination = approval_request.get("chat_id") or group_id

                if self.approval_service and group_id:
                    bot = Bot(token=get_settings().bot_token)
                    try:
                        await self.approval_service.create_prompt(
                            group_id=int(group_id),
                            assignment_id=str(assignment_id),
                            task_key=str(task_key),
                            agent_id=agent.id,
                            destination=destination,
                            prompt_text=str(approval_request.get("prompt_text") or "").strip(),
                            private_reply_text=str(
                                approval_request.get("private_reply_text") or ""
                            ).strip(),
                            target_user_id=int(target_user_id),
                            source_group_title=str(
                                approval_request.get("source_group_title") or ""
                            ).strip(),
                            original_message_text=str(
                                approval_request.get("original_message_text") or ""
                            ).strip(),
                            source_chat_id=approval_request.get("source_chat_id"),
                            source_message_id=approval_request.get("source_message_id"),
                            bot=bot,
                        )
                    finally:
                        await bot.session.close()

            result = await definition.handler(task_config, event)
            if not isinstance(result, dict):
                return True

            if result.get("status") == "skipped":
                logger.warning(
                    "agent_task_skipped",
                    agent_id=agent.id,
                    task_key=task_key,
                    assignment_id=assignment_id,
                    reason=result.get("reason"),
                )
                if task_key == "lead_capture":
                    await self._capture_lead(
                        agent=agent, session=session, event=event, result=result
                    )
                if self.activity_service and assignment_id:
                    await self.activity_service.record_activity(
                        assignment_id=str(assignment_id),
                        status="skipped",
                        error=str(result.get("reason") or "unknown"),
                    )
                return True

            if task_key == "lead_capture":
                await self._capture_lead(agent=agent, session=session, event=event, result=result)

            chat_id = result.get("chat_id") or event.payload.get("chat_id") or event.group_id
            text = result.get("text", "")
            if text:
                reply_to = result.get("reply_to_message_id")
                kwargs = {}
                if reply_to:
                    kwargs["reply_to"] = reply_to
                sent = None
                if result.get("_safety_mode"):
                    sent = await send_message_with_timeout(client, chat_id, text, **kwargs)
                    logger.info("safety_mode_action_executed", agent_id=agent.id, task_key=task_key)
                else:
                    sent = await send_message_with_timeout(client, chat_id, text, **kwargs)

                delete_after = result.get("delete_after_seconds", 0)
                if delete_after > 0 and sent is not None:
                    bot_message_id = sent.id

                    async def _delete_later():
                        await asyncio.sleep(delete_after)
                        try:
                            await client.delete_messages(chat_id, [bot_message_id])
                        except Exception:
                            pass

                    asyncio.ensure_future(_delete_later())

            if self.activity_service and assignment_id:
                await self.activity_service.record_activity(
                    assignment_id=str(assignment_id),
                    status="success",
                )

            return True
        except Exception as exc:
            logger.exception(
                "agent_task_execution_failed", task_key=task_key, assignment_id=assignment_id
            )
            if self.activity_service and assignment_id:
                await self.activity_service.record_activity(
                    assignment_id=str(assignment_id),
                    status="failed",
                    error=str(exc),
                )
            raise

    async def _capture_lead(self, *, agent, session, event: "TaskEvent", result: dict) -> None:
        try:
            from bot.services.agent_lead_service import AgentLeadService

            lead_label = str((result.get("metadata") or {}).get("lead_label") or "general")
            lead_service = AgentLeadService(session)
            await lead_service.capture_lead(
                agent_id=agent.id,
                group_id=agent.group_id or 0,
                tg_user_id=event.user_id,
                username=str(event.payload.get("username") or ""),
                first_name=str(event.payload.get("first_name") or ""),
                last_name=str(event.payload.get("full_name") or "").split()[-1]
                if event.payload.get("full_name")
                else None,
                source_group_tg_id=event.payload.get("chat_id") or event.group_id,
                source_group_title=str(event.payload.get("group_title") or ""),
                source_message_id=event.payload.get("message_id"),
                message_text=str(event.payload.get("text") or ""),
                lead_label=lead_label,
                confidence=0.6,
            )
        except Exception:
            logger.exception("lead_capture_persistence_failed", agent_id=agent.id)
            try:
                await session.rollback()
            except Exception:
                pass
