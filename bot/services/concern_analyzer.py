from __future__ import annotations

from typing import Any

from bot.db.session import AsyncSession
from bot.services.admission_llm import call_admission_llm
from bot.services.admission_prompts import CONCERN_CLUSTERING_PROMPT
from bot.services.scraper_service import ScraperService

CONCERN_TOPICS = {
    "acceptance_odds": ["نسبة القبول", "فرز", "معدلي"],
    "registration_process": ["تسجيل", "بوابة القبول", "موعد التسجيل"],
    "housing": ["سكن", "إسكان جامعي"],
    "major_choice": ["تخصص", "ترتيب التخصصات", "كلية"],
}

TOPIC_DISPLAY_NAMES = {
    "acceptance_odds": "فرص القبول",
    "registration_process": "التسجيل",
    "housing": "السكن الجامعي",
    "major_choice": "اختيار التخصص",
}


class ConcernAnalyzer:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._scraper = ScraperService(session)

    async def analyze(self, tg_group_id: int) -> dict[str, Any]:
        topics: list[dict[str, Any]] = []

        for category, terms in CONCERN_TOPICS.items():
            all_results: list[dict[str, Any]] = []
            for term in terms:
                result_data = await self._scraper.search_messages(
                    tg_group_id=tg_group_id,
                    query=term,
                    page_size=20,
                )
                messages = result_data.get("messages", [])
                all_results.extend(messages)

            if not all_results:
                continue

            samples = await cluster_concerns(category, all_results)
            display_name = TOPIC_DISPLAY_NAMES.get(category, category)
            topics.append(
                {
                    "name": display_name,
                    "mentions": len(all_results),
                    "examples": samples.get("examples", []),
                }
            )

        topics.sort(key=lambda t: t["mentions"], reverse=True)
        return {"topics": topics, "method": "keyword_clustering"}


async def cluster_concerns(category: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    joined = "\n".join(f"- {m.get('message_text', '')}" for m in messages[:30] if m.get("message_text"))
    prompt = CONCERN_CLUSTERING_PROMPT.format(
        category=category, count=len(messages), messages=joined
    )
    text = await call_admission_llm(prompt, system_kind="text", max_tokens=250)
    if text:
        return {"name": category, "mentions": len(messages), "examples": [text]}
    raw = [m.get("message_text", "") for m in messages[:3] if m.get("message_text")]
    return {"name": category, "mentions": len(messages), "examples": raw}
