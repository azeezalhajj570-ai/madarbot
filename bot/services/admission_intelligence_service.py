from __future__ import annotations

from typing import Any

from sqlalchemy import select

from bot.db.models.scraper import ScrapedGroup
from bot.db.session import AsyncSession
from bot.services.admission_search_service import AdmissionSearchService
from bot.services.concern_analyzer import ConcernAnalyzer
from bot.services.cutoff_analyzer import CutoffAnalyzer


class AdmissionIntelligenceService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._search = AdmissionSearchService(session)
        self._cutoff = CutoffAnalyzer(session)
        self._concerns = ConcernAnalyzer(session)

    async def resolve_scraped_group_id(self, tg_group_id: int) -> int | None:
        result = await self.session.execute(
            select(ScrapedGroup.id).where(ScrapedGroup.tg_group_id == tg_group_id)
        )
        return result.scalar_one_or_none()

    async def search_admissions(
        self,
        tg_group_id: int,
        query: str,
        university: str | None = None,
        major: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        return await self._search.search(
            tg_group_id=tg_group_id,
            query=query,
            university=university,
            major=major,
            date_from=date_from,
            date_to=date_to,
        )

    async def cutoff_trend(
        self,
        tg_group_id: int,
        university: str,
        major: str,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        return await self._cutoff.analyze(
            tg_group_id=tg_group_id,
            university=university,
            major=major,
            date_from=date_from,
            date_to=date_to,
        )

    async def student_concerns(self, tg_group_id: int) -> dict[str, Any]:
        return await self._concerns.analyze(tg_group_id=tg_group_id)

    async def compare_universities(
        self,
        tg_group_id: int,
        university_a: str,
        university_b: str,
        major: str,
    ) -> dict[str, Any]:
        cutoff_a = await self._cutoff.analyze(tg_group_id, university_a, major)
        cutoff_b = await self._cutoff.analyze(tg_group_id, university_b, major)
        return {
            "universities": [
                {"name": university_a, "major": major, "cutoff": cutoff_a},
                {"name": university_b, "major": major, "cutoff": cutoff_b},
            ],
            "notes": (
                f"Both universities queried against the same synced group "
                f"(tg_group_id={tg_group_id}) — join and sync additional "
                "university-specific communities for a real cross-community comparison."
            ),
        }
