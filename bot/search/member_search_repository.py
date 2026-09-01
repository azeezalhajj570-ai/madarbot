"""Execution layer for compiled member-search queries.

Runs the parameterized member SELECT, computes ``has_more`` via limit+1, and
optionally an exact COUNT when the caller explicitly wants a total and the
result set is expected to be small. Never loads the full scraped-message set.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

# Result sets below this size get an exact COUNT when the caller asks for a
# total; larger sets return has_more only (the UI renders "N+ matching").
EXACT_COUNT_MAX = 10_000


class MemberSearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def fetch_page(
        self,
        *,
        stmt: Select,
        count_stmt: Select | None,
        page: int,
        page_size: int,
        include_total: bool,
    ) -> dict[str, Any]:
        rows = (await self.session.execute(stmt)).all()
        has_more = len(rows) > page_size
        page_rows = rows[:page_size]

        total: int | None = None
        if include_total and count_stmt is not None:
            total = int((await self.session.execute(count_stmt)).scalar_one() or 0)
            if total > EXACT_COUNT_MAX:
                total = None  # too expensive; caller falls back to has_more

        return {
            "items": [_serialize(row) for row in page_rows],
            "page": page,
            "page_size": page_size,
            "has_more": has_more,
            "total": total,
        }

    @staticmethod
    def serialize_member(row: Any) -> dict[str, Any]:
        return _serialize(row)


def _serialize(row: Any) -> dict[str, Any]:
    return {
        "member_id": int(row.tg_user_id),
        "tg_user_id": int(row.tg_user_id),
        "username": row.username,
        "display_name": row.full_name or row.first_name or row.last_name,
        "first_name": row.first_name,
        "last_name": row.last_name,
        "full_name": row.full_name,
        "role": row.role,
        "is_bot": bool(row.is_bot),
        "tg_group_id": int(row.tg_group_id),
        "message_count": None,
        "last_message_at": None,
    }
