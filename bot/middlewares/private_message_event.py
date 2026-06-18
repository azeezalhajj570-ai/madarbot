"""Middleware that publishes private text messages to EventBus without blocking routers."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject

from bot.core.event_bus import Event, EventBus

MiddlewareHandler = Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]]


class PrivateMessageEventMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: MiddlewareHandler,
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if isinstance(event, Message) and event.chat.type == "private" and event.text:
            user_id = event.from_user.id if event.from_user else None
            event_bus: EventBus = data.get("event_bus")
            if event_bus:
                await event_bus.publish(
                    Event(
                        name="MessageReceived",
                        group_id=None,
                        user_id=user_id,
                        payload={
                            "text": event.text,
                            "message_id": event.message_id,
                            "chat_id": event.chat.id,
                            "bot": event.bot,
                            "chat_type": event.chat.type,
                            "redis": data.get("redis"),
                        },
                    )
                )

        return await handler(event, data)
