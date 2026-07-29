from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models.scraper import GroupKnowledge, ScrapedDailySummary, ScrapedGroup, ScrapedMessage
from bot.services.scraper_service import ScraperService

log = structlog.get_logger(__name__)

ADMISSION_GROUP_KEYWORDS = ["قبول", "admission", "جامعة", "تنسيق", "كلية", "هندسة", "طب"]

UNIVERSITY_KEYWORDS = [
    "جامعة القاهرة", "جامعة عين شمس", "جامعة الإسكندرية", "جامعة المنصورة",
    "جامعة أسيوط", "جامعة طنطا", "جامعة الزقازيق", "جامعة حلوان",
    "جامعة بنها", "جامعة المنوفية", "جامعة كفر الشيخ", "جامعة سوهاج",
    "جامعة جنوب الوادي", "جامعة الفيوم", "جامعة بني سويف",
    "جامعة بورسعيد", "جامعة دمنهور", "جامعة السويس", "جامعة العريش",
    "جامعة مطروح", "جامعة الأزهر", "جامعة القاهرة الجديدة",
    "جامعة النيل", "جامعة زويل", "الجامعة الأمريكية",
    "جامعة 6 أكتوبر", "جامعة أكتوبر", "جامعة المستقبل",
    "جامعة الأهرام الكندية", "جامعة فاروس", "جامعة الدلتا",
    "جامعة العلوم والتكنولوجيا", "جامعة النهضة", "جامعة مصر",
    "جامعة مصر الدولية", "جامعة هليوبوليس", "جامعة بدر",
    "Cairo University", "Ain Shams University", "Alexandria University",
]

CUTOFF_QUERY_TERMS = ["نسبة القبول", "الحد الأدنى", "فرز ثاني", "كم نسبة", "نسبتي", "مجموع"]

PERCENT_RE = re.compile(r"\b(\d{2}(?:\.\d{1,2})?)\b")
PLAUSIBLE_MIN, PLAUSIBLE_MAX = 50.0, 100.0


class AdmissionOverviewService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._scraper = ScraperService(session)

    async def get_overview(self) -> dict[str, Any]:
        admission_group_ids = await self._get_admission_group_ids()

        if not admission_group_ids:
            return self._empty_overview()

        today = datetime.utcnow()
        week_ago = today - timedelta(days=7)

        daily_stats = await self._get_daily_stats(admission_group_ids, week_ago)
        trending = await self._get_trending_universities(admission_group_ids, week_ago)
        hot_topics = await self._get_hot_topics(admission_group_ids)

        return {
            "stats": {
                "messages_today": daily_stats["messages_today"],
                "messages_this_week": daily_stats["messages_this_week"],
                "active_groups": daily_stats["active_groups"],
                "monitored_groups": len(admission_group_ids),
            },
            "trending_universities": trending,
            "hot_topics": hot_topics,
            "last_updated": today.isoformat(),
        }

    async def get_trending_universities(self) -> dict[str, Any]:
        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            return {"universities": [], "method": "keyword_match"}

        today = datetime.utcnow()
        trending = await self._get_trending_universities(admission_group_ids, today - timedelta(days=30))
        return {"universities": trending, "method": "keyword_match"}

    async def get_activity(self) -> dict[str, Any]:
        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            return {"daily": []}

        today = datetime.utcnow()
        month_ago = today - timedelta(days=30)
        result = await self.session.execute(
            select(
                ScrapedDailySummary.date,
                func.sum(ScrapedDailySummary.message_count).label("message_count"),
            )
            .where(
                ScrapedDailySummary.scraped_group_id.in_(admission_group_ids),
                ScrapedDailySummary.date >= month_ago,
            )
            .group_by(ScrapedDailySummary.date)
            .order_by(ScrapedDailySummary.date)
        )
        rows = result.all()
        return {
            "daily": [
                {
                    "date": r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date),
                    "message_count": int(r.message_count),
                }
                for r in rows
            ]
        }

    async def _get_admission_group_ids(self) -> list[int]:
        result = await self.session.execute(
            select(ScrapedGroup.id).where(
                func.lower(ScrapedGroup.title).like("%قبول%")
                | func.lower(ScrapedGroup.title).like("%admission%")
                | func.lower(ScrapedGroup.title).like("%جامعة%")
                | func.lower(ScrapedGroup.title).like("%تنسيق%")
                | func.lower(ScrapedGroup.title).like("%كلية%")
            )
        )
        return [r[0] for r in result.all()]

    async def _get_daily_stats(self, group_ids: list[int], since: datetime) -> dict[str, Any]:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

        result = await self.session.execute(
            select(
                func.sum(ScrapedDailySummary.message_count).label("total"),
            )
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= today_start,
            )
        )
        messages_today = int(result.scalar_one() or 0)

        result = await self.session.execute(
            select(
                func.sum(ScrapedDailySummary.message_count).label("total"),
            )
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= since,
            )
        )
        messages_this_week = int(result.scalar_one() or 0)

        result = await self.session.execute(
            select(func.count(func.distinct(ScrapedDailySummary.scraped_group_id)))
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= since,
            )
        )
        active_groups = int(result.scalar_one() or 0)

        return {
            "messages_today": messages_today,
            "messages_this_week": messages_this_week,
            "active_groups": active_groups,
        }

    async def _get_trending_universities(self, group_ids: list[int], since: datetime) -> list[dict[str, Any]]:
        group_id_to_tg = await self._get_tg_group_ids(group_ids)
        tg_ids = list(group_id_to_tg.values())

        mention_counts: dict[str, int] = {}
        uni_pattern = re.compile("|".join(re.escape(u) for u in UNIVERSITY_KEYWORDS), re.IGNORECASE)

        for term in CUTOFF_QUERY_TERMS:
            for tg_id in tg_ids:
                try:
                    result_data = await self._scraper.search_messages(
                        tg_group_id=tg_id,
                        query=term,
                        date_from=since,
                        page_size=50,
                    )
                    for m in result_data.get("messages", []):
                        text = m.get("message_text", "") or ""
                        matches = uni_pattern.findall(text)
                        for uni in matches:
                            mention_counts[uni.strip()] = mention_counts.get(uni.strip(), 0) + 1
                except Exception as e:
                    log.warning("overview_search_failed", tg_group_id=tg_id, term=term, error=str(e))

        sorted_unis = sorted(mention_counts.items(), key=lambda x: -x[1])[:10]
        max_count = max(c for _, c in sorted_unis) if sorted_unis else 1

        return [
            {
                "name": uni,
                "mention_count_7d": count,
                "mention_count_1d": count // 7,
                "trend": "rising" if count > max_count * 0.7 else "falling" if count < max_count * 0.3 else "stable",
            }
            for uni, count in sorted_unis
        ]

    async def _get_hot_topics(self, group_ids: list[int]) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(GroupKnowledge)
            .where(
                GroupKnowledge.scraped_group_id.in_(group_ids),
                GroupKnowledge.knowledge_type.in_(["topic", "trend"]),
            )
            .order_by(desc(GroupKnowledge.confidence))
            .limit(10)
        )
        rows = result.scalars().all()

        topic_map: dict[str, dict[str, Any]] = {}
        for r in rows:
            title = r.title or r.content or "unknown"
            if title not in topic_map:
                topic_map[title] = {
                    "topic": title,
                    "mentions": 0,
                    "trend": "stable",
                }
            topic_map[title]["mentions"] += 1

        return sorted(topic_map.values(), key=lambda t: -t["mentions"])[:8]

    async def _get_tg_group_ids(self, group_ids: list[int]) -> dict[int, int]:
        result = await self.session.execute(
            select(ScrapedGroup.id, ScrapedGroup.tg_group_id).where(ScrapedGroup.id.in_(group_ids))
        )
        return {r[0]: r[1] for r in result.all()}

    def _empty_overview(self) -> dict[str, Any]:
        return {
            "stats": {
                "messages_today": 0,
                "messages_this_week": 0,
                "active_groups": 0,
                "monitored_groups": 0,
            },
            "trending_universities": [],
            "hot_topics": [],
            "last_updated": datetime.utcnow().isoformat(),
        }
