"""AI Intelligence layer for admission queries.

Provides LLM-based intent classification, conversation-aware answering,
and dynamic suggestion generation from trending data.
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from bot.services.admission_llm import call_admission_llm

logger = structlog.get_logger(__name__)

INTENT_CLASSIFICATION_PROMPT = """You are an admission intent classifier. Given a student's question about university admission in Saudi Arabia, classify it into exactly ONE of these categories:

- cutoff: Questions about acceptance percentages, minimum scores, GPA requirements for a specific university/major
- comparison: Questions comparing two or more universities, majors, or programs
- concerns: Questions expressing worry, confusion, or asking about common problems (housing, registration, major choice)
- search: Any other admission-related question (requirements, deadlines, documents, general info)

Return ONLY a JSON object with:
{{"intent": "<category>", "reason": "<one-line explanation>", "entities": {{"university": "<detected or null>", "major": "<detected or null>"}}}}

Question: {query}
"""


async def classify_intent(query: str, user_id: int | None = None) -> dict[str, Any]:
    """Classify an admission query into an intent category using LLM."""
    prompt = INTENT_CLASSIFICATION_PROMPT.format(query=query)
    result = await call_admission_llm(prompt, system_kind="json", max_tokens=200, user_id=user_id)
    if result:
        try:
            parsed = json.loads(result)
            if parsed.get("intent") in ("cutoff", "comparison", "concerns", "search"):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return {"intent": "search", "reason": "fallback_after_llm_failure", "entities": {"university": None, "major": None}}


async def generate_suggestions(
    trending: list[dict[str, Any]],
    hot_topics: list[dict[str, Any]],
    max_suggestions: int = 6,
) -> list[dict[str, str]]:
    """Generate contextual suggestion pills from trending data."""
    suggestions: list[dict[str, str]] = []

    trending_names = [t.get("name", "") for t in trending[:4] if t.get("name")]
    hot_names = [h.get("topic", "") for h in hot_topics[:3] if h.get("topic")]

    if trending_names:
        suggestions.append({
            "label": f"📊 Cutoff trends at {trending_names[0]}",
            "query": f"نسبة القبول في {trending_names[0]}",
        })
    if len(trending_names) >= 2:
        suggestions.append({
            "label": f"🔄 Compare {trending_names[0][:20]} vs {trending_names[1][:20]}",
            "query": f"مقارنة بين {trending_names[0]} و {trending_names[1]}",
        })
    if hot_names:
        suggestions.append({
            "label": f"🔥 {hot_names[0][:35]}",
            "query": hot_names[0],
        })
    if len(hot_names) >= 2:
        suggestions.append({
            "label": f"💬 {hot_names[1][:35]}",
            "query": hot_names[1],
        })

    suggestions.extend([
        {"label": "🎓 أفضل الجامعات السعودية", "query": "أفضل الجامعات السعودية"},
        {"label": "📋 شروط القبول في الجامعات", "query": "شروط القبول في الجامعات السعودية"},
    ])

    return suggestions[:max_suggestions]
