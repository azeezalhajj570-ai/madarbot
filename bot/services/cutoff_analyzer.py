from __future__ import annotations

import re
from datetime import datetime as dt
from typing import Any

from bot.db.session import AsyncSession
from bot.services.scraper_service import ScraperService

CUTOFF_QUERY_TERMS = ["نسبة القبول", "الحد الأدنى", "فرز ثاني", "كم نسبة"]

PERCENT_RE = re.compile(r"\b(\d{2}(?:\.\d{1,2})?)\b")
PLAUSIBLE_MIN, PLAUSIBLE_MAX = 50.0, 100.0


def _extract_plausible_percentages(text: str) -> list[float]:
    if not text:
        return []
    candidates = [float(x) for x in PERCENT_RE.findall(text)]
    return [c for c in candidates if PLAUSIBLE_MIN <= c <= PLAUSIBLE_MAX]


class CutoffAnalyzer:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._scraper = ScraperService(session)

    async def analyze(
        self,
        tg_group_id: int,
        university: str,
        major: str,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
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

        history: list[dict[str, Any]] = []

        for term in CUTOFF_QUERY_TERMS:
            result_data = await self._scraper.search_messages(
                tg_group_id=tg_group_id,
                query=term,
                date_from=parsed_from,
                date_to=parsed_to,
                page_size=200,
            )
            messages = result_data.get("messages", [])

            for m in messages:
                text = m.get("message_text", "") or ""
                if university not in text and major not in text:
                    continue
                for pct in _extract_plausible_percentages(text):
                    history.append(
                        {
                            "date": m.get("message_date", ""),
                            "value": pct,
                            "source": f"message_id:{m.get('message_id', 'unknown')}",
                        }
                    )

        history.sort(key=lambda h: h["date"])

        if len(history) < 2:
            trend = "insufficient_data"
            summary = (
                f"Only {len(history)} plausible cutoff value(s) found for "
                f"{university} / {major} — not enough signal for a trend yet."
            )
        else:
            delta = history[-1]["value"] - history[0]["value"]
            trend = "rising" if delta > 0.5 else "falling" if delta < -0.5 else "stable"
            summary = (
                f"Reported cutoffs for {university} / {major} moved from "
                f"{history[0]['value']}% to {history[-1]['value']}% across "
                f"{len(history)} applicant-reported data points."
            )

        return {"trend": trend, "summary": summary, "cutoff_history": history}
