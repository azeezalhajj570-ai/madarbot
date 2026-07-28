from __future__ import annotations

from typing import Any

from bot.config import get_settings
from bot.db.session import AsyncSession
from bot.services.admission_llm import call_admission_llm
from bot.services.admission_prompts import SEARCH_SYNTHESIS_PROMPT
from bot.services.scraper_service import ScraperService


def _confidence(hit_count: int) -> str:
    if hit_count >= 5:
        return "high"
    if hit_count >= 2:
        return "medium"
    return "low"


class AdmissionSearchService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._scraper = ScraperService(session)

    async def search(
        self,
        tg_group_id: int,
        query: str,
        university: str | None = None,
        major: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        from datetime import datetime as dt

        parsed_from: dt | None = None
        parsed_to: dt | None = None
        if date_from:
            try:
                parsed_from = dt.fromisoformat(date_from)
            except ValueError:
                pass
        if date_to:
            try:
                parsed_to = dt.fromisoformat(date_to)
            except ValueError:
                pass

        result_data = await self._scraper.search_messages(
            tg_group_id=tg_group_id,
            query=query,
            date_from=parsed_from,
            date_to=parsed_to,
            page_size=100,
        )

        messages = result_data.get("messages", [])
        total = result_data.get("total", 0)
        hint = " ".join(p for p in [university, major] if p)
        full_query = f"{query} ({hint})" if hint else query

        answer_context = await synthesize_search_answer(full_query, messages)
        conf = _confidence(total)

        sources = [
            {
                "message": "see synthesized answer_context above",
                "date": m.get("message_date", ""),
                "group": "admission_group",
                "confidence": conf,
            }
            for m in messages[:10]
        ]

        return {"answer_context": answer_context, "sources": sources, "total_matches": total}


async def synthesize_search_answer(query: str, messages: list[dict[str, Any]]) -> str:
    if not messages:
        return "No matching applicant discussions were found for this query."
    joined = "\n".join(f"- {m.get('message_text', '')}" for m in messages[:40] if m.get("message_text"))
    prompt = SEARCH_SYNTHESIS_PROMPT.format(query=query, messages=joined)
    result = await call_admission_llm(prompt, system_kind="text")
    if result:
        return result
    samples = [m.get("message_text", "") for m in messages[:5] if m.get("message_text")]
    if samples:
        return "Sample messages found:\n" + "\n".join(f"• {s[:300]}" for s in samples)
    return "Messages found but no text content available."
