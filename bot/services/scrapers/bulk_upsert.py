from __future__ import annotations

from typing import Any

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import ScrapedConversation, ScrapedGroup, ScrapedMember, ScrapedMessage


async def get_dialect_name(session: AsyncSession) -> str:
    bind = getattr(session, "bind", None)
    if bind is None:
        sync_session = getattr(session, "_session", None)
        bind = getattr(sync_session, "bind", None)
    return bind.dialect.name if bind is not None else "postgresql"


async def build_upsert_statement(
    *,
    model,
    rows: list[dict[str, Any]],
    index_elements: list[str],
    update_columns: list[str],
    session: AsyncSession,
):
    dialect_name = await get_dialect_name(session)
    if dialect_name == "postgresql":
        statement = postgresql_insert(model).values(rows)
    elif dialect_name == "sqlite":
        statement = sqlite_insert(model).values(rows)
    else:
        raise RuntimeError(f"Unsupported database dialect for scraper upsert: {dialect_name or 'unknown'}")

    return statement.on_conflict_do_update(
        index_elements=index_elements,
        set_={column: getattr(statement.excluded, column) for column in update_columns},
    )


async def bulk_upsert_scraped_groups(rows: list[dict[str, Any]], session: AsyncSession) -> None:
    if not rows:
        return

    unique_rows: dict[int, dict[str, Any]] = {}
    for row in rows:
        unique_rows[row["tg_group_id"]] = row
    rows = list(unique_rows.values())

    statement = await build_upsert_statement(
        model=ScrapedGroup,
        rows=rows,
        index_elements=["tg_group_id"],
        update_columns=[
            "last_agent_id", "title", "username", "group_type",
            "member_count", "description", "raw_data", "updated_at",
        ],
        session=session,
    )
    await session.execute(statement)


async def bulk_upsert_scraped_members(rows: list[dict[str, Any]], session: AsyncSession) -> None:
    if not rows:
        return

    unique_rows = {(row["tg_group_id"], row["tg_user_id"]): row for row in rows}
    rows = list(unique_rows.values())

    statement = await build_upsert_statement(
        model=ScrapedMember,
        rows=rows,
        index_elements=["tg_group_id", "tg_user_id"],
        update_columns=[
            "scraped_group_id", "username", "first_name", "last_name", "full_name",
            "phone", "is_bot", "is_premium", "role", "joined_date", "raw_data", "scraped_at",
        ],
        session=session,
    )
    await session.execute(statement)


async def bulk_upsert_scraped_messages(rows: list[dict[str, Any]], session: AsyncSession) -> None:
    if not rows:
        return

    unique_rows = {(row["tg_group_id"], row["message_id"]): row for row in rows}
    rows = list(unique_rows.values())

    statement = await build_upsert_statement(
        model=ScrapedMessage,
        rows=rows,
        index_elements=["tg_group_id", "message_id"],
        update_columns=[
            "scraped_group_id", "sender_user_id", "sender_username", "sender_first_name",
            "sender_last_name", "message_text", "message_date", "message_type", "media_file_id",
            "media_url", "reply_to_message_id", "reply_to_top_id", "forward_from_user_id",
            "raw_data", "scraped_at",
        ],
        session=session,
    )
    await session.execute(statement)


async def bulk_upsert_scraped_conversations(rows: list[dict[str, Any]], session: AsyncSession) -> None:
    if not rows:
        return

    unique_rows: dict[tuple[int, int], dict[str, Any]] = {}
    for row in rows:
        key = (row["scraped_group_id"], row["root_message_id"])
        existing = unique_rows.get(key)
        if existing is None or (row.get("message_count") or 0) >= (existing.get("message_count") or 0):
            unique_rows[key] = row
    rows = list(unique_rows.values())

    statement = await build_upsert_statement(
        model=ScrapedConversation,
        rows=rows,
        index_elements=["scraped_group_id", "root_message_id"],
        update_columns=[
            "root_message_text", "root_sender_user_id", "root_sender_name",
            "title", "participant_count", "message_count",
            "first_message_at", "last_message_at", "is_topic",
        ],
        session=session,
    )
    await session.execute(statement)


async def bulk_upsert_scraped_messages(rows: list[dict[str, Any]], session: AsyncSession) -> None:
    if not rows:
        return

    unique_rows = {(row["tg_group_id"], row["message_id"]): row for row in rows}
    rows = list(unique_rows.values())

    statement = await build_upsert_statement(
        model=ScrapedMessage,
        rows=rows,
        index_elements=["tg_group_id", "message_id"],
        update_columns=[
            "scraped_group_id",
            "sender_user_id",
            "sender_username",
            "sender_first_name",
            "sender_last_name",
            "message_text",
            "message_date",
            "message_type",
            "media_file_id",
            "media_url",
            "reply_to_message_id",
            "reply_to_top_id",
            "forward_from_user_id",
            "raw_data",
            "scraped_at",
        ],
        session=session,
    )
    await session.execute(statement)
