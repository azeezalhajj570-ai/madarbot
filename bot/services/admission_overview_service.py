from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any

import structlog
from redis.asyncio import Redis
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models.scraper import GroupKnowledge, ScrapedDailySummary, ScrapedGroup, ScrapedMessage
from bot.db.models.scraper import ScrapedLead
from bot.services.scraper_service import ScraperService

log = structlog.get_logger(__name__)

ADMISSION_GROUP_KEYWORDS = ["قبول", "admission", "جامعة", "تنسيق", "كلية", "هندسة", "طب"]

DEFAULT_UNIVERSITY_KEYWORDS = [
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

CACHE_TTL = {
    "overview": 600,
    "trending": 900,
    "activity": 1800,
    "universities": 3600,
}

ADMISSION_LEAD_SIGNALS = [
    "كم نسبة", "نسبتي", "مجموعي", "هل يقبل", "هل ينفع",
    "أقدر", "التحق", "أدرس", "قدمت", "عارض", "ساعدني",
    "help", "advice", "chance", "admission", "accept",
]


class AdmissionOverviewService:
    def __init__(self, session: AsyncSession, redis: Redis | None = None):
        self.session = session
        self._scraper = ScraperService(session)
        self._redis = redis

    async def _cache_get(self, key: str) -> dict | None:
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(f"admission:{key}")
            return json.loads(raw) if raw else None
        except Exception as e:
            log.warning("cache_get_failed", key=key, error=str(e))
            return None

    async def _cache_set(self, key: str, value: dict, ttl: int) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.set(f"admission:{key}", json.dumps(value, ensure_ascii=False, default=str), ex=ttl)
        except Exception as e:
            log.warning("cache_set_failed", key=key, error=str(e))

    async def get_overview(self) -> dict[str, Any]:
        cached = await self._cache_get("overview")
        if cached:
            return cached

        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            result = self._empty_overview()
            await self._cache_set("overview", result, CACHE_TTL["overview"])
            return result

        today = datetime.utcnow()
        week_ago = today - timedelta(days=7)

        daily_stats = await self._get_daily_stats(admission_group_ids, week_ago)
        trending = await self._get_trending_universities(admission_group_ids, week_ago)
        hot_topics = await self._get_hot_topics(admission_group_ids)

        result = {
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

        await self._cache_set("overview", result, CACHE_TTL["overview"])
        return result

    async def get_trending_universities(self) -> dict[str, Any]:
        cached = await self._cache_get("trending")
        if cached:
            return cached

        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            return {"universities": [], "method": "keyword_match"}

        today = datetime.utcnow()
        trending = await self._get_trending_universities(admission_group_ids, today - timedelta(days=30))
        result = {"universities": trending, "method": "keyword_match"}
        await self._cache_set("trending", result, CACHE_TTL["trending"])
        return result

    async def get_activity(self) -> dict[str, Any]:
        cached = await self._cache_get("activity")
        if cached:
            return cached

        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            return {"daily": []}

        today = datetime.utcnow()
        month_ago = today - timedelta(days=30)
        result_rows = await self.session.execute(
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
        rows = result_rows.all()
        result = {
            "daily": [
                {
                    "date": r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date),
                    "message_count": int(r.message_count),
                }
                for r in rows
            ]
        }
        await self._cache_set("activity", result, CACHE_TTL["activity"])
        return result

    async def get_universities(self) -> dict[str, Any]:
        cached = await self._cache_get("universities")
        if cached:
            return cached

        all_names = list(DEFAULT_UNIVERSITY_KEYWORDS)

        result_rows = await self.session.execute(
            select(ScrapedGroup.title).where(
                ScrapedGroup.title.isnot(None),
                ScrapedGroup.title.like("%جامعة%"),
            )
        )
        for row in result_rows.all():
            title = row[0]
            if title and title not in all_names:
                all_names.append(title)

        all_names = sorted(set(all_names))
        result = {"universities": all_names, "total": len(all_names)}
        await self._cache_set("universities", result, CACHE_TTL["universities"])
        return result

    async def extract_admission_leads(
        self, hours_back: int = 24, min_confidence: float = 0.3
    ) -> dict[str, Any]:
        admission_group_ids = await self._get_admission_group_ids()
        if not admission_group_ids:
            return {"leads": [], "total": 0}

        since = datetime.utcnow() - timedelta(hours=hours_back)
        tg_ids = list((await self._get_tg_group_ids(admission_group_ids)).values())

        leads: list[dict[str, Any]] = []
        seen: set[str] = set()

        for signal in ADMISSION_LEAD_SIGNALS:
            for tg_id in tg_ids:
                try:
                    result_data = await self._scraper.search_messages(
                        tg_group_id=tg_id, query=signal, date_from=since, page_size=30,
                    )
                    for m in result_data.get("messages", []):
                        text = m.get("message_text", "") or ""
                        uid = m.get("sender_user_id")
                        mid = m.get("message_id")
                        dedup_key = f"{uid}:{mid}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        confidence = self._score_lead_confidence(text)
                        if confidence < min_confidence:
                            continue

                        uni_matches = re.findall(
                            "|".join(re.escape(u) for u in DEFAULT_UNIVERSITY_KEYWORDS),
                            text, re.IGNORECASE,
                        )

                        leads.append({
                            "sender_user_id": uid,
                            "sender_name": m.get("sender_first_name", "") or m.get("sender_username", "") or "Unknown",
                            "message_text": text[:300],
                            "signal": signal,
                            "confidence": round(confidence, 2),
                            "mentioned_universities": list(set(uni_matches))[:3],
                            "message_date": m.get("message_date", ""),
                            "tg_group_id": tg_id,
                        })
                except Exception as e:
                    log.warning("lead_extract_failed", tg_group_id=tg_id, signal=signal, error=str(e))

        leads.sort(key=lambda x: -x["confidence"])
        return {"leads": leads[:50], "total": len(leads)}

    def _score_lead_confidence(self, text: str) -> float:
        score = 0.3
        question_words = ["كم", "هل", "هل", "ما", "كيف", "how", "what", "can", "is it"]
        urgency_words = ["ضروري", "مستعجل", "quick", "urgent", "help", "pls", "please", "ساعد"]
        detail_words = ["نسبة", "مجموع", "grade", "gpa", "percent", "معدل"]

        text_lower = text.lower()
        if any(w in text_lower for w in question_words):
            score += 0.2
        if any(w in text_lower for w in urgency_words):
            score += 0.2
        if any(w in text_lower for w in detail_words):
            score += 0.15
        if len(text) > 50:
            score += 0.15

        return min(score, 1.0)

    async def _get_admission_group_ids(self) -> list[int]:
        result_rows = await self.session.execute(
            select(ScrapedGroup.id).where(
                func.lower(ScrapedGroup.title).like("%قبول%")
                | func.lower(ScrapedGroup.title).like("%admission%")
                | func.lower(ScrapedGroup.title).like("%جامعة%")
                | func.lower(ScrapedGroup.title).like("%تنسيق%")
                | func.lower(ScrapedGroup.title).like("%كلية%")
            )
        )
        return [r[0] for r in result_rows.all()]

    async def _get_daily_stats(self, group_ids: list[int], since: datetime) -> dict[str, Any]:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

        result_rows = await self.session.execute(
            select(func.sum(ScrapedDailySummary.message_count).label("total"))
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= today_start,
            )
        )
        messages_today = int(result_rows.scalar_one() or 0)

        result_rows = await self.session.execute(
            select(func.sum(ScrapedDailySummary.message_count).label("total"))
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= since,
            )
        )
        messages_this_week = int(result_rows.scalar_one() or 0)

        result_rows = await self.session.execute(
            select(func.count(func.distinct(ScrapedDailySummary.scraped_group_id)))
            .where(
                ScrapedDailySummary.scraped_group_id.in_(group_ids),
                ScrapedDailySummary.date >= since,
            )
        )
        active_groups = int(result_rows.scalar_one() or 0)

        return {
            "messages_today": messages_today,
            "messages_this_week": messages_this_week,
            "active_groups": active_groups,
        }

    async def _get_trending_universities(self, group_ids: list[int], since: datetime) -> list[dict[str, Any]]:
        group_id_to_tg = await self._get_tg_group_ids(group_ids)
        tg_ids = list(group_id_to_tg.values())

        mention_counts: dict[str, int] = {}
        uni_pattern = re.compile("|".join(re.escape(u) for u in DEFAULT_UNIVERSITY_KEYWORDS), re.IGNORECASE)

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
        result_rows = await self.session.execute(
            select(GroupKnowledge)
            .where(
                GroupKnowledge.scraped_group_id.in_(group_ids),
                GroupKnowledge.knowledge_type.in_(["topic", "trend"]),
            )
            .order_by(desc(GroupKnowledge.confidence))
            .limit(10)
        )
        rows = result_rows.scalars().all()

        topic_map: dict[str, dict[str, Any]] = {}
        for r in rows:
            title = r.title or r.content or "unknown"
            if title not in topic_map:
                topic_map[title] = {"topic": title, "mentions": 0, "trend": "stable"}
            topic_map[title]["mentions"] += 1

        return sorted(topic_map.values(), key=lambda t: -t["mentions"])[:8]

    async def _get_tg_group_ids(self, group_ids: list[int]) -> dict[int, int]:
        result_rows = await self.session.execute(
            select(ScrapedGroup.id, ScrapedGroup.tg_group_id).where(ScrapedGroup.id.in_(group_ids))
        )
        return {r[0]: r[1] for r in result_rows.all()}

    async def clear_cache(self) -> None:
        if self._redis is None:
            return
        try:
            keys = await self._redis.keys("admission:*")
            if keys:
                await self._redis.delete(*keys)
            log.info("cache_cleared", count=len(keys))
        except Exception as e:
            log.warning("cache_clear_failed", error=str(e))

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
