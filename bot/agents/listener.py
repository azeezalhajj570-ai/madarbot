from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

import hashlib
import structlog
from sqlalchemy import desc, select

from bot.agents.exceptions import AgentBannedError, AgentSessionRevokedError
from bot.agents.session import SessionManager
from bot.agents.dispatch import dispatch_agent_job
from bot.config import get_settings
from bot.db.models import Agent, AgentBlacklistEntry, AgentJob, Group, GroupAdminRole, GroupSetting, ModerationLog, SentBroadcastMessage
from bot.db.session import SessionLocal
from bot.services.agent_lead_service import AgentLeadService
from bot.services.group_service import GroupService, canonical_tg_group_id, upsert_group_member
from bot.services.scraper_service import ScraperService
from bot.services.task_assignment_store import TASKS_SETTING_KEY
from bot.services.task_service import TaskService
from bot.workers.tasks import schedule_bot_message_delete, schedule_task_follow_up


logger = structlog.get_logger(__name__)
_URL_RE = re.compile(r"(https?://\S+|www\.\S+)", re.IGNORECASE)
_DIRECT_SEND_TIMEOUT_SECONDS = 30
_DIRECT_RESPOND_MAX_AGE_SECONDS = 30 * 60
_LEAD_CAPTURE_USER_COOLDOWN_SECONDS = 5 * 60


def _message_contains_link(text: str) -> bool:
    return bool(_URL_RE.search(text or ""))


def _is_terminal_listener_error(exc: Exception) -> bool:
    if isinstance(exc, (AgentBannedError, AgentSessionRevokedError)):
        return True
    try:
        from telethon.errors import (
            AuthKeyDuplicatedError,
            AuthKeyNotFound,
            AuthKeyPermEmptyError,
            AuthKeyUnregisteredError,
            PhoneNumberBannedError,
            SessionExpiredError,
            SessionRevokedError,
            UnauthorizedError,
            UserDeactivatedBanError,
            UserDeactivatedError,
        )
    except ImportError:
        return False
    return isinstance(
        exc,
        (
            AuthKeyDuplicatedError,
            AuthKeyNotFound,
            AuthKeyPermEmptyError,
            AuthKeyUnregisteredError,
            PhoneNumberBannedError,
            SessionExpiredError,
            SessionRevokedError,
            UnauthorizedError,
            UserDeactivatedBanError,
            UserDeactivatedError,
        ),
    )


class AgentListenerManager:
    def __init__(
        self,
        *,
        bot: Any,
        session_factory=SessionLocal,
        session_manager: SessionManager | None = None,
        sync_interval_seconds: int = 15,
        log_message_events: bool | None = None,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
        redis: Any = None,
    ) -> None:
        self.bot = bot
        self.session_factory = session_factory
        self.session_manager = session_manager or SessionManager(session_factory=session_factory)
        self.sync_interval_seconds = max(int(sync_interval_seconds), 5)
        if log_message_events is None:
            log_message_events = get_settings().log_agent_listener_messages
        self.log_message_events = bool(log_message_events)
        self.sleep = sleep
        self.redis = redis
        self._agent_tasks: dict[int, asyncio.Task[Any]] = {}
        self._sync_task: asyncio.Task[Any] | None = None
        self._stopping = False

    async def start(self) -> None:
        if self._sync_task is not None and not self._sync_task.done():
            return
        self._stopping = False
        await self._sync_active_agents()
        self._sync_task = asyncio.create_task(self._sync_loop(), name="agent-listener-sync")

    async def stop(self) -> None:
        self._stopping = True
        if self._sync_task is not None:
            self._sync_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._sync_task
            self._sync_task = None
        running_tasks = list(self._agent_tasks.values())
        self._agent_tasks.clear()
        for task in running_tasks:
            task.cancel()
        for task in running_tasks:
            with suppress(asyncio.CancelledError):
                await task

    async def _sync_loop(self) -> None:
        while not self._stopping:
            try:
                await self._sync_active_agents()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("agent_listener_sync_failed")
            await self.sleep(self.sync_interval_seconds)

    async def _sync_active_agents(self) -> None:
        async with self.session_factory() as session:
            rows = (
                await session.execute(
                    select(Agent.id).where(
                        Agent.auth_state == "active",
                        Agent.session_string.is_not(None),
                        Agent.status != "banned",
                    )
                )
            ).all()
        active_agent_ids = {int(row.id) for row in rows}
        for agent_id in list(self._agent_tasks):
            if agent_id not in active_agent_ids:
                task = self._agent_tasks.pop(agent_id)
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        for agent_id in active_agent_ids:
            task = self._agent_tasks.get(agent_id)
            if task is None or task.done():
                self._agent_tasks[agent_id] = asyncio.create_task(
                    self._run_agent_listener(agent_id),
                    name=f"agent-listener-{agent_id}",
                )

    async def _run_agent_listener(self, agent_id: int) -> None:
        try:
            from telethon import events
        except ImportError:
            logger.warning("agent_listener_telethon_unavailable", agent_id=agent_id)
            return

        reconnect_delay = 5
        max_reconnect_delay = 60
        while not self._stopping:
            client = None
            handler = None
            connected_at = None
            try:
                connected_at = asyncio.get_running_loop().time()
                client = await self.session_manager.get_client(agent_id)

                async def _handle(event) -> None:
                    await self._handle_telethon_message(agent_id, event, client)

                handler = _handle
                client.add_event_handler(_handle, events.NewMessage(incoming=True))
                logger.info("agent_listener_started", agent_id=agent_id)

                # Sync groups to DB on start/reload for high-performance search
                async def _sync_groups():
                    with suppress(Exception):
                        async with self.session_factory() as session:
                            await ScraperService(session).sync_agent_groups(
                                agent_id=agent_id, client=client
                            )

                asyncio.create_task(_sync_groups())

                await client.run_until_disconnected()
                logger.warning("agent_listener_disconnected", agent_id=agent_id)
            except asyncio.CancelledError:
                if client is not None and handler is not None:
                    with suppress(Exception):
                        client.remove_event_handler(handler)
                if client is not None:
                    with suppress(Exception):
                        await client.disconnect()
                raise
            except Exception as exc:
                logger.exception("agent_listener_failed", agent_id=agent_id)
                if _is_terminal_listener_error(exc):
                    if client is not None and handler is not None:
                        with suppress(Exception):
                            client.remove_event_handler(handler)
                    if client is not None:
                        with suppress(Exception):
                            await client.disconnect()
                    if isinstance(exc, AgentSessionRevokedError):
                        await self.session_manager.mark_failed(agent_id)
                    elif isinstance(exc, AgentBannedError):
                        await self.session_manager.mark_banned(agent_id)
                    logger.warning(
                        "agent_listener_stopped_terminal_error",
                        agent_id=agent_id,
                        error=type(exc).__name__,
                    )
                    return
                if self._stopping:
                    if client is not None and handler is not None:
                        with suppress(Exception):
                            client.remove_event_handler(handler)
                    if client is not None:
                        with suppress(Exception):
                            await client.disconnect()
                    return

            # Clean up handler and disconnect after normal disconnect or non-terminal error
            if client is not None and handler is not None:
                with suppress(Exception):
                    client.remove_event_handler(handler)
            if client is not None:
                with suppress(Exception):
                    await client.disconnect()

            # Backoff: wait before reconnecting so a concurrent worker can finish using the
            # same Telegram session. Reset delay after a stable connection.
            if connected_at is not None:
                connected_duration = asyncio.get_running_loop().time() - connected_at
                if connected_duration >= 60:
                    reconnect_delay = 5
                else:
                    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay)
            logger.info(
                "agent_listener_reconnecting",
                agent_id=agent_id,
                delay_seconds=reconnect_delay,
                connected_duration=(
                    asyncio.get_running_loop().time() - connected_at if connected_at else None
                ),
            )
            await self.sleep(reconnect_delay)

    async def _handle_telethon_message(
        self, agent_id: int, event: Any, client: Any | None = None
    ) -> None:
        chat_id = getattr(event, "chat_id", None)
        if chat_id is None:
            return
        chat_id = int(chat_id)
        sender_id = getattr(event, "sender_id", None)
        text = str(getattr(event, "raw_text", None) or "").strip()
        chat = None
        sender = None
        with suppress(Exception):
            chat = await event.get_chat()
        with suppress(Exception):
            sender = await event.get_sender()
        message_id = getattr(event, "message", None) and getattr(event.message, "id", None)
        message_date = getattr(event.message, "date", None)
        chat_title = str(getattr(chat, "title", None) or "")
        username = str(getattr(sender, "username", None) or "")
        first_name = str(getattr(sender, "first_name", None) or "")
        full_name = " ".join(
            part
            for part in [
                str(getattr(sender, "first_name", None) or "").strip(),
                str(getattr(sender, "last_name", None) or "").strip(),
            ]
            if part
        )
        is_bot = bool(getattr(sender, "bot", False))
        if self.log_message_events:
            logger.info(
                "agent_listener_message_seen",
                agent_id=agent_id,
                chat_id=chat_id,
                user_id=int(sender_id) if sender_id is not None else None,
                message_id=message_id,
                text=text,
                group_title=chat_title,
                username=username,
                first_name=first_name,
                full_name=full_name,
                is_group=chat_id < 0,
            )
        if chat_id >= 0:
            await self._handle_private_message(
                agent_id=agent_id,
                client=client,
                chat_id=chat_id,
                sender_id=int(sender_id) if sender_id is not None else None,
                text=text,
            )
            return
        await self._persist_seen_group_message(
            agent_id=agent_id,
            chat_id=chat_id,
            group_title=chat_title,
            text=text,
            message_id=message_id,
            user_id=int(sender_id) if sender_id is not None else None,
            first_name=first_name,
            full_name=full_name,
            username=username,
        )
        await self._dispatch_agent_message(
            agent_id,
            client=client,
            chat_id=chat_id,
            group_title=chat_title,
            text=text,
            message_id=message_id,
            message_date=message_date,
            user_id=int(sender_id) if sender_id is not None else None,
            first_name=first_name,
            full_name=full_name,
            username=username,
            is_bot=is_bot,
        )

        await self._handle_group_mention(
            agent_id=agent_id,
            client=client,
            text=text,
            message_id=message_id,
            chat_id=chat_id,
            sender_id=int(sender_id) if sender_id is not None else None,
        )

    async def _handle_private_message(
        self,
        *,
        agent_id: int,
        client: Any,
        chat_id: int,
        sender_id: int | None,
        text: str,
    ) -> None:
        if not text or client is None or self.redis is None:
            return

        from bot.config import get_settings

        settings = get_settings()
        if not settings.ai_pilot_enabled:
            return

        from bot.plugins.ai_pilot.provider import build_pilot_provider
        from bot.plugins.ai_pilot.service import AIPilotService
        from bot.services.settings_service import SettingsService

        api_key: str | None = None
        model: str | None = None
        provider_url: str | None = None
        system_prompt: str | None = None
        max_history = 10
        rate_limit_max = 5
        rate_limit_window_s = 60

        async with self.session_factory() as session:
            agent = (
                await session.execute(select(Agent).where(Agent.id == agent_id))
            ).scalar_one_or_none()
            group_id = int(agent.group_id) if agent and agent.group_id is not None else None

            if group_id is not None:
                ssvc = SettingsService(session)
                raw_api_key = await ssvc.get_one(group_id, "ai_pilot_api_key")
                if raw_api_key:
                    api_key = str(raw_api_key)
                raw_model = await ssvc.get_one(group_id, "ai_pilot_model")
                if raw_model:
                    model = str(raw_model)
                raw_url = await ssvc.get_one(group_id, "ai_pilot_provider_url")
                if raw_url:
                    provider_url = str(raw_url)
                raw_prompt = await ssvc.get_one(group_id, "ai_pilot_system_prompt")
                if raw_prompt:
                    system_prompt = str(raw_prompt)

                raw_max = await ssvc.get_one(group_id, "ai_pilot_max_history")
                if raw_max is not None:
                    try:
                        max_history = int(raw_max)
                    except (ValueError, TypeError):
                        pass
                raw_rl_max = await ssvc.get_one(group_id, "ai_pilot_rate_limit_max")
                if raw_rl_max is not None:
                    try:
                        rate_limit_max = int(raw_rl_max)
                    except (ValueError, TypeError):
                        pass
                raw_rl_win = await ssvc.get_one(group_id, "ai_pilot_rate_limit_window_s")
                if raw_rl_win is not None:
                    try:
                        rate_limit_window_s = int(raw_rl_win)
                    except (ValueError, TypeError):
                        pass

        provider = build_pilot_provider(
            api_key=api_key,
            model=model,
            base_url=provider_url,
        )
        service = AIPilotService(
            redis=self.redis,
            provider=provider,
            system_prompt=system_prompt,
            model=model,
            max_history=max_history,
            rate_limit_max=rate_limit_max,
            rate_limit_window_s=rate_limit_window_s,
        )
        reply = await service.generate_reply(sender_id or chat_id, text)
        if reply is None:
            return

        try:
            await client.send_message(chat_id, reply)
            logger.info(
                "agent_dm_reply_sent",
                agent_id=agent_id,
                chat_id=chat_id,
                user_id=sender_id,
                reply_length=len(reply),
            )
        except Exception as exc:
            logger.warning(
                "agent_dm_reply_failed",
                agent_id=agent_id,
                chat_id=chat_id,
                user_id=sender_id,
                error=str(exc),
            )

    async def _handle_group_mention(
        self,
        *,
        agent_id: int,
        client: Any,
        text: str,
        message_id: int | None,
        chat_id: int,
        sender_id: int | None = None,
    ) -> None:
        if not text or client is None:
            return
        agent_username: str | None = None
        async with self.session_factory() as session:
            agent = (
                await session.execute(select(Agent).where(Agent.id == agent_id))
            ).scalar_one_or_none()
            if agent is None:
                return
            agent_username = str((agent.details or {}).get("username") or "").strip().lstrip("@")
            if not agent_username:
                return
            group_id = int(agent.group_id) if agent.group_id is not None else None
            if group_id is None:
                return
            from bot.services.settings_service import SettingsService

            svc = SettingsService(session)
            mention_enabled = await svc.get_one(group_id, "ai_mention_reply_enabled")
            if not mention_enabled:
                return
            if f"@{agent_username.lower()}" not in text.lower():
                return
            from bot.plugins.ai_pilot.provider import build_pilot_provider
            from bot.plugins.ai_pilot.service import AIPilotService

            api_key: str | None = None
            model: str | None = None
            provider_url: str | None = None
            system_prompt: str | None = None
            max_history = 10
            rate_limit_max = 5
            rate_limit_window_s = 60
            raw_api_key = await svc.get_one(group_id, "ai_pilot_api_key")
            if raw_api_key:
                api_key = str(raw_api_key)
            raw_model = await svc.get_one(group_id, "ai_pilot_model")
            if raw_model:
                model = str(raw_model)
            raw_url = await svc.get_one(group_id, "ai_pilot_provider_url")
            if raw_url:
                provider_url = str(raw_url)
            raw_prompt = await svc.get_one(group_id, "ai_pilot_system_prompt")
            if raw_prompt:
                system_prompt = str(raw_prompt)
            raw_max = await svc.get_one(group_id, "ai_pilot_max_history")
            if raw_max is not None:
                try:
                    max_history = int(raw_max)
                except (ValueError, TypeError):
                    pass
            raw_rl_max = await svc.get_one(group_id, "ai_pilot_rate_limit_max")
            if raw_rl_max is not None:
                try:
                    rate_limit_max = int(raw_rl_max)
                except (ValueError, TypeError):
                    pass
            raw_rl_win = await svc.get_one(group_id, "ai_pilot_rate_limit_window_s")
            if raw_rl_win is not None:
                try:
                    rate_limit_window_s = int(raw_rl_win)
                except (ValueError, TypeError):
                    pass
            if self.redis is None:
                return
            provider = build_pilot_provider(
                api_key=api_key,
                model=model,
                base_url=provider_url,
            )
            ai_service = AIPilotService(
                redis=self.redis,
                provider=provider,
                system_prompt=system_prompt,
                model=model,
                max_history=max_history,
                rate_limit_max=rate_limit_max,
                rate_limit_window_s=rate_limit_window_s,
            )
            reply = await ai_service.generate_reply(sender_id or chat_id, text)
            if reply is None:
                return
            try:
                await client.send_message(chat_id, reply, reply_to=message_id)
                logger.info(
                    "agent_group_mention_reply_sent",
                    agent_id=agent_id,
                    chat_id=chat_id,
                    reply_length=len(reply),
                )
            except Exception as exc:
                logger.warning(
                    "agent_group_mention_reply_failed",
                    agent_id=agent_id,
                    chat_id=chat_id,
                    error=str(exc),
                )

    async def _persist_seen_group_message(
        self,
        *,
        agent_id: int,
        chat_id: int,
        group_title: str,
        text: str,
        message_id: int | None,
        user_id: int | None,
        first_name: str = "",
        full_name: str = "",
        username: str = "",
    ) -> None:
        try:
            async with self.session_factory() as session:
                agent = (
                    await session.execute(select(Agent).where(Agent.id == agent_id))
                ).scalar_one_or_none()
                owner_user_id = (
                    int(agent.linked_by_user_id)
                    if agent is not None and agent.linked_by_user_id is not None
                    else None
                )
                group = await GroupService(session).get_or_create_by_tg_id(
                    tg_group_id=chat_id,
                    title=group_title or None,
                    owner_tg_user_id=owner_user_id,
                    is_active=False,
                )
                if user_id is not None:
                    await upsert_group_member(
                        session,
                        group_id=group.id,
                        tg_user_id=int(user_id),
                        username=username or None,
                        full_name=full_name or first_name or None,
                        role="member",
                        source="agent_message_seen",
                    )
                session.add(
                    ModerationLog(
                        group_id=group.id,
                        action="agent_message_seen",
                        target_user_id=user_id,
                        admin_user_id=int(agent.telegram_user_id)
                        if agent is not None and agent.telegram_user_id is not None
                        else None,
                        reason=text or None,
                        details={
                            "agent_id": agent_id,
                            "chat_id": int(chat_id),
                            "group_title": group_title,
                            "message_id": int(message_id) if message_id is not None else None,
                            "text": text,
                            "username": username,
                            "first_name": first_name,
                            "full_name": full_name,
                        },
                    )
                )
                await session.commit()
        except Exception:
            logger.exception(
                "agent_listener_message_persist_failed", agent_id=agent_id, chat_id=chat_id
            )

    async def _dispatch_agent_message(
        self,
        agent_id: int,
        *,
        client: Any,
        chat_id: int,
        group_title: str,
        text: str,
        message_id: int | None,
        message_date: Any | None = None,
        user_id: int | None,
        first_name: str = "",
        full_name: str = "",
        username: str = "",
        is_bot: bool = False,
    ) -> bool:
        async with self.session_factory() as session:
            group = await self._resolve_listener_group(session, agent_id=agent_id, chat_id=chat_id)
            if group is None:
                return False
            # Resolve the actual source group by chat_id for admin/blacklist checks.
            # The resolved `group` may be the assignment holder when group_tg_ids spans
            # multiple groups, so use the source chat's own group when available.
            source_group = (
                await session.execute(
                    select(Group).where(Group.tg_group_id == canonical_tg_group_id(int(chat_id)))
                )
            ).scalar_one_or_none() or group
            if self.log_message_events:
                logger.info(
                    "agent_listener_message_received",
                    agent_id=agent_id,
                    group_id=group.id,
                    source_group_id=source_group.id,
                    chat_id=chat_id,
                    user_id=user_id,
                    message_id=message_id,
                    text=text,
                )
            source_title = group_title
            if not source_title:
                source_title_row = (
                    await session.execute(
                        select(Group.title).where(
                            Group.tg_group_id == canonical_tg_group_id(int(chat_id))
                        )
                    )
                ).scalar_one_or_none()
                source_title = source_title_row or str(chat_id)
            results = await TaskService(
                session,
                dispatch_agent_job=dispatch_agent_job,
                dispatch_follow_up=schedule_task_follow_up,
                dispatch_delete_message=schedule_bot_message_delete,
            ).handle_agent_message_event(
                group_id=group.id,
                agent_id=agent_id,
                source_chat_id=chat_id,
                user_id=user_id,
                payload={
                    "chat_id": chat_id,
                    "group_title": source_title,
                    "text": text,
                    "message_id": message_id,
                    "message_date": message_date,
                    "first_name": first_name,
                    "full_name": full_name,
                    "username": username,
                    "bot": self.bot,
                    "contains_link": _message_contains_link(text),
                    "lang": get_settings().default_language,
                },
            )
            for result in results or []:
                if result.get("_listener_handled") and result.get("_handler_result"):
                    await self._handle_direct_lead_capture(
                        agent_id=agent_id,
                        client=client,
                        session=session,
                        job_id=result.get("job_id"),
                        handler_result=result["_handler_result"],
                        task_config=result.get("_task_config") or {},
                        event_payload={
                            "chat_id": chat_id,
                            "group_title": source_title,
                            "text": text,
                            "message_id": message_id,
                            "first_name": first_name,
                            "full_name": full_name,
                            "username": username,
                        },
                        message_date=message_date,
                        user_id=user_id,
                        group=source_group,
                        is_bot=is_bot,
                    )
            return True

    async def _handle_direct_lead_capture(
        self,
        *,
        agent_id: int,
        client: Any,
        session: Any,
        job_id: int | None,
        handler_result: dict[str, Any],
        task_config: dict[str, Any],
        event_payload: dict[str, Any],
        message_date: Any | None,
        user_id: int | None,
        group: Any | None = None,
        is_bot: bool = False,
    ) -> None:
        """Send a lead_capture auto-respond directly from the listener's client.

        This keeps the worker from taking over the same Telegram session and knocking
        the listener offline, so subsequent messages are not missed.
        """
        if client is None:
            return

        agent = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one_or_none()
        if agent is None:
            return

        text = str(handler_result.get("text") or "")

        # Skip blacklisted users, group admins, and bots
        skip_reason = await self._get_lead_capture_skip_reason(
            session=session,
            agent_id=agent_id,
            group=group,
            user_id=user_id,
            username=str(event_payload.get("username") or ""),
            is_bot=is_bot,
        )
        if skip_reason:
            logger.info(
                "direct_lead_capture_skipped",
                agent_id=agent_id,
                user_id=user_id,
                skip_reason=skip_reason,
            )
            if job_id is not None:
                try:
                    job = (
                        await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                    ).scalar_one_or_none()
                    if job is not None:
                        job.status = "completed"
                        payload = dict(job.job_payload or {})
                        payload["result"] = {
                            "sent": False,
                            "handled_by_listener": True,
                            "reason": skip_reason,
                        }
                        payload["progress"] = {
                            "total_count": 0,
                            "success_count": 0,
                            "failure_count": 0,
                        }
                        payload["message"] = text[:200]
                        job.job_payload = payload
                        await session.commit()
                except Exception:
                    logger.exception(
                        "direct_lead_capture_job_update_failed",
                        agent_id=agent_id,
                        job_id=job_id,
                    )
                    try:
                        await session.rollback()
                    except Exception:
                        pass
            return

        # Skip users who already got a lead capture reply recently
        if user_id is not None:
            cooldown_seconds = (int(task_config.get("cooldown_minutes") or 43200)) * 60
            if cooldown_seconds > 0:
                last_reply = (
                    await session.execute(
                        select(SentBroadcastMessage)
                        .where(
                            SentBroadcastMessage.agent_id == agent_id,
                            SentBroadcastMessage.tg_user_id == user_id,
                            SentBroadcastMessage.status == "sent",
                        )
                        .order_by(desc(SentBroadcastMessage.sent_at))
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if last_reply is not None:
                    elapsed = (datetime.now(timezone.utc) - last_reply.sent_at).total_seconds()
                    if elapsed < cooldown_seconds:
                        logger.info(
                            "direct_lead_capture_skipped",
                            agent_id=agent_id,
                            user_id=user_id,
                            skip_reason="recently_responded",
                            last_reply_at=last_reply.sent_at.isoformat(),
                            elapsed_seconds=elapsed,
                        )
                        if job_id is not None:
                            try:
                                job = (
                                    await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                                ).scalar_one_or_none()
                                if job is not None:
                                    job.status = "completed"
                                    payload = dict(job.job_payload or {})
                                    payload["result"] = {
                                        "sent": False,
                                        "handled_by_listener": True,
                                        "reason": "recently_responded",
                                    }
                                    payload["progress"] = {
                                        "total_count": 0,
                                        "success_count": 0,
                                        "failure_count": 0,
                                    }
                                    payload["message"] = text[:200]
                                    job.job_payload = payload
                                    await session.commit()
                            except Exception:
                                logger.exception(
                                    "direct_lead_capture_job_update_failed",
                                    agent_id=agent_id,
                                    job_id=job_id,
                                )
                                try:
                                    await session.rollback()
                                except Exception:
                                    pass
                        return

        # Skip if agent replied to any other contact recently (inter-contact cooldown)
        inter_cooldown = (int(task_config.get("inter_contact_cooldown_minutes") or 12)) * 60
        if inter_cooldown > 0:
            last_any_reply = (
                await session.execute(
                    select(SentBroadcastMessage)
                    .where(
                        SentBroadcastMessage.agent_id == agent_id,
                        SentBroadcastMessage.status == "sent",
                    )
                    .order_by(desc(SentBroadcastMessage.sent_at))
                    .limit(1)
                )
            ).scalar_one_or_none()
            if last_any_reply is not None:
                elapsed = (datetime.now(timezone.utc) - last_any_reply.sent_at).total_seconds()
                if elapsed < inter_cooldown:
                    logger.info(
                        "direct_lead_capture_skipped",
                        agent_id=agent_id,
                        user_id=user_id,
                        skip_reason="inter_contact_cooldown",
                        last_reply_at=last_any_reply.sent_at.isoformat(),
                        elapsed_seconds=elapsed,
                    )
                    if job_id is not None:
                        try:
                            job = (
                                await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                            ).scalar_one_or_none()
                            if job is not None:
                                job.status = "completed"
                                payload = dict(job.job_payload or {})
                                payload["result"] = {
                                    "sent": False,
                                    "handled_by_listener": True,
                                    "reason": "inter_contact_cooldown",
                                }
                                payload["progress"] = {
                                    "total_count": 0,
                                    "success_count": 0,
                                    "failure_count": 0,
                                }
                                payload["message"] = text[:200]
                                job.job_payload = payload
                                await session.commit()
                        except Exception:
                            logger.exception(
                                "direct_lead_capture_job_update_failed",
                                agent_id=agent_id,
                                job_id=job_id,
                            )
                            try:
                                await session.rollback()
                            except Exception:
                                pass
                    return

        # Skip the auto-respond if the original message is too old
        if isinstance(message_date, datetime):
            age_seconds = (datetime.now(timezone.utc) - message_date).total_seconds()
            if age_seconds > _DIRECT_RESPOND_MAX_AGE_SECONDS:
                logger.warning(
                    "direct_lead_capture_stale",
                    agent_id=agent_id,
                    user_id=user_id,
                    message_id=event_payload.get("message_id"),
                    age_seconds=age_seconds,
                    max_age_seconds=_DIRECT_RESPOND_MAX_AGE_SECONDS,
                )
                if job_id is not None:
                    try:
                        job = (
                            await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                        ).scalar_one_or_none()
                        if job is not None:
                            job.status = "completed"
                            payload = dict(job.job_payload or {})
                            payload["result"] = {
                                "sent": False,
                                "handled_by_listener": True,
                                "reason": "stale",
                            }
                            payload["progress"] = {
                                "total_count": 0,
                                "success_count": 0,
                                "failure_count": 0,
                            }
                            payload["message"] = str(text)[:200]
                            job.job_payload = payload
                            await session.commit()
                    except Exception:
                        logger.exception(
                            "direct_lead_capture_job_update_failed",
                            agent_id=agent_id,
                            job_id=job_id,
                        )
                        try:
                            await session.rollback()
                        except Exception:
                            pass
                return

        # Enforce daily limit on new contacts
        max_new_contacts = int(task_config.get("max_new_contacts_per_day") or 0)
        if max_new_contacts > 0 and self.redis is not None and user_id is not None:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            key = f"agent:{agent_id}:new_contacts:{today}"
            already_counted = await self.redis.sismember(key, str(user_id))
            if not already_counted:
                count = await self.redis.scard(key)
                if int(count) >= max_new_contacts:
                    logger.warning(
                        "direct_lead_capture_daily_limit_reached",
                        agent_id=agent_id,
                        user_id=user_id,
                        max_new_contacts=max_new_contacts,
                        daily_count=count,
                    )
                    if job_id is not None:
                        try:
                            job = (
                                await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                            ).scalar_one_or_none()
                            if job is not None:
                                job.status = "completed"
                                payload = dict(job.job_payload or {})
                                payload["result"] = {
                                    "sent": False,
                                    "handled_by_listener": True,
                                    "reason": "daily_limit_reached",
                                }
                                payload["progress"] = {
                                    "total_count": 0,
                                    "success_count": 0,
                                    "failure_count": 0,
                                }
                                payload["message"] = str(text)[:200]
                                job.job_payload = payload
                                await session.commit()
                        except Exception:
                            logger.exception(
                                "direct_lead_capture_job_update_failed",
                                agent_id=agent_id,
                                job_id=job_id,
                            )
                            try:
                                await session.rollback()
                            except Exception:
                                pass
                    return
            await self.redis.sadd(key, str(user_id))
            await self.redis.expire(key, 86400)

        # Capture the lead first
        try:
            metadata = dict(handler_result.get("metadata") or {})
            lead_service = AgentLeadService(session)
            await lead_service.capture_lead(
                agent_id=agent.id,
                group_id=agent.group_id or 0,
                tg_user_id=user_id,
                username=str(event_payload.get("username") or ""),
                first_name=str(event_payload.get("first_name") or ""),
                last_name=str(event_payload.get("full_name") or "").split()[-1]
                if event_payload.get("full_name")
                else None,
                source_group_tg_id=event_payload.get("chat_id") or 0,
                source_group_title=str(event_payload.get("group_title") or ""),
                source_message_id=event_payload.get("message_id"),
                message_text=str(event_payload.get("text") or ""),
                lead_label=str(metadata.get("lead_label") or "general"),
                confidence=0.6,
            )
        except Exception:
            logger.exception("direct_lead_capture_persistence_failed", agent_id=agent_id)
            try:
                await session.rollback()
            except Exception:
                pass

        # Forward the original message if requested
        forward_info = handler_result.get("forward_message")
        if isinstance(forward_info, dict):
            forward_chat_id = handler_result.get("chat_id") or user_id
            if forward_chat_id:
                try:
                    await asyncio.wait_for(
                        client.forward_messages(
                            entity=forward_chat_id,
                            messages=forward_info["message_id"],
                            from_peer=forward_info["from_chat"],
                        ),
                        timeout=_DIRECT_SEND_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "direct_lead_capture_forward_timeout",
                        agent_id=agent_id,
                        timeout_seconds=_DIRECT_SEND_TIMEOUT_SECONDS,
                    )
                except Exception:
                    logger.exception("direct_lead_capture_forward_failed", agent_id=agent_id)

        # Optional delay before the ack message
        respond_delay = handler_result.get("respond_delay_seconds", 0)
        if respond_delay and isinstance(respond_delay, (int, float)) and respond_delay > 0:
            await self.sleep(respond_delay)

        # Send the ack message
        chat_id = handler_result.get("chat_id") or event_payload.get("chat_id") or 0
        text = handler_result.get("text", "")
        sent_message_id: int | None = None
        send_status = "failed"
        if text and chat_id:
            try:
                sent_message = await asyncio.wait_for(
                    client.send_message(
                        int(chat_id),
                        str(text),
                        reply_to=handler_result.get("reply_to_message_id"),
                    ),
                    timeout=_DIRECT_SEND_TIMEOUT_SECONDS,
                )
                sent_message_id = getattr(sent_message, "id", None)
                send_status = "sent"
                logger.info(
                    "direct_lead_capture_reply_sent",
                    agent_id=agent_id,
                    chat_id=chat_id,
                    user_id=user_id,
                    message_id=event_payload.get("message_id"),
                    sent_message_id=sent_message_id,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "direct_lead_capture_reply_timeout",
                    agent_id=agent_id,
                    chat_id=chat_id,
                    timeout_seconds=_DIRECT_SEND_TIMEOUT_SECONDS,
                )
            except Exception:
                logger.exception("direct_lead_capture_reply_failed", agent_id=agent_id)

        # Log the sent message so it appears in task activity send logs.
        if job_id is not None and user_id is not None:
            try:
                message_hash = hashlib.sha256(
                    f"{user_id}:{text}".encode()
                ).hexdigest()
                session.add(
                    SentBroadcastMessage(
                        agent_id=agent_id,
                        sender_tg_user_id=agent.telegram_user_id,
                        job_id=job_id,
                        tg_user_id=user_id,
                        username=str(event_payload.get("username") or "") or None,
                        message_id=sent_message_id,
                        tg_chat_id=user_id,
                        tg_group_id=int(chat_id) if chat_id else 0,
                        message_text=str(text),
                        message_hash=message_hash,
                        status=send_status,
                        sent_at=datetime.now(timezone.utc),
                        created_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
            except Exception:
                logger.exception("direct_lead_capture_send_log_failed", agent_id=agent_id, job_id=job_id)
                try:
                    await session.rollback()
                except Exception:
                    pass

        # Mark the tracking job as completed with progress
        if job_id is not None:
            try:
                job = (
                    await session.execute(select(AgentJob).where(AgentJob.id == job_id))
                ).scalar_one_or_none()
                if job is not None:
                    job.status = "completed"
                    payload = dict(job.job_payload or {})
                    payload["result"] = {
                        "sent": send_status == "sent",
                        "handled_by_listener": True,
                    }
                    payload["progress"] = {
                        "total_count": 1,
                        "success_count": 1 if send_status == "sent" else 0,
                        "failure_count": 0 if send_status == "sent" else 1,
                    }
                    payload["message"] = str(text)[:200]
                    job.job_payload = payload
                    await session.commit()
            except Exception:
                logger.exception("direct_lead_capture_job_update_failed", agent_id=agent_id, job_id=job_id)
                try:
                    await session.rollback()
                except Exception:
                    pass

    async def _get_lead_capture_skip_reason(
        self,
        *,
        session: Any,
        agent_id: int,
        group: Any | None,
        user_id: int | None,
        username: str,
        is_bot: bool,
    ) -> str | None:
        """Return a reason to skip lead_capture auto-respond, or None if allowed."""
        if is_bot:
            return "bot"
        if user_id is None:
            return None

        # Check per-agent blacklist by tg_user_id or username
        try:
            from sqlalchemy import or_

            normalized_username = username.lstrip("@").strip().lower()
            filters = [AgentBlacklistEntry.agent_id == agent_id]
            identity_filters = [AgentBlacklistEntry.tg_user_id == user_id]
            if normalized_username:
                identity_filters.append(
                    AgentBlacklistEntry.username == normalized_username
                )
            entry = (
                await session.execute(
                    select(AgentBlacklistEntry).where(
                        *filters,
                        or_(*identity_filters),
                    )
                )
            ).scalar_one_or_none()
            if entry is not None:
                return "blacklist"
        except Exception:
            logger.exception(
                "lead_capture_blacklist_check_failed", agent_id=agent_id, user_id=user_id
            )

        # Check group admin roles
        try:
            if group is not None and getattr(group, "id", None) is not None:
                admin_role = (
                    await session.execute(
                        select(GroupAdminRole).where(
                            GroupAdminRole.group_id == group.id,
                            GroupAdminRole.user_id == user_id,
                        )
                    )
                ).scalar_one_or_none()
                if admin_role is not None:
                    return "admin"
        except Exception:
            logger.exception(
                "lead_capture_admin_check_failed", agent_id=agent_id, user_id=user_id
            )

        return None

    async def _resolve_listener_group(
        self, session: Any, *, agent_id: int, chat_id: int
    ) -> Group | None:
        rows = (
            await session.execute(
                select(Group.id, Group.tg_group_id, Group.title, GroupSetting.value)
                .join(GroupSetting, GroupSetting.group_id == Group.id)
                .where(GroupSetting.key == TASKS_SETTING_KEY)
            )
        ).all()
        canonical_chat_id = canonical_tg_group_id(int(chat_id))
        for row in rows:
            assignments = row.value.get("value") if isinstance(row.value, dict) else None
            if not isinstance(assignments, list):
                continue
            has_matching_assignment = any(
                isinstance(item, dict)
                and str(item.get("executor_type") or "").strip() == "agent"
                and int(item.get("agent_id") or 0) == agent_id
                and bool(item.get("enabled", True))
                and (
                    any(
                        canonical_tg_group_id(int(group_tg_id)) == canonical_chat_id
                        for group_tg_id in (item.get("group_tg_ids") or [])
                        if group_tg_id not in {None, ""}
                    )
                    or (
                        not (item.get("group_tg_ids") or [])
                        and canonical_tg_group_id(int(row.tg_group_id)) == canonical_chat_id
                    )
                )
                for item in assignments
            )
            if not has_matching_assignment:
                continue
            group_rows = (
                (await session.execute(select(Group).where(Group.id == int(row.id))))
                .scalars()
                .all()
            )
            if group_rows:
                return group_rows[0]
        return None
