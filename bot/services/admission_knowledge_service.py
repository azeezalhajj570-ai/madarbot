"""Admission knowledge extraction pipeline.

Extracts structured entities (universities, majors, cutoffs, FAQs) from
scraped Telegram messages into normalized database tables.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import (
    AdmissionCutoff,
    AdmissionFAQ,
    AdmissionKnowledgeExtraction,
    AdmissionMajor,
    AdmissionUniversity,
)
from bot.db.models.scraper import ScrapedMessage
from bot.services.scraper_service import ScraperService

logger = structlog.get_logger(__name__)

# ─── Known seed data ──────────────────────────────────────────────────────────

SAUDI_UNIVERSITIES = [
    "جامعة الملك سعود", "جامعة الملك عبدالعزيز", "جامعة الملك فهد للبترول والمعادن",
    "جامعة الملك فيصل", "جامعة الملك خالد", "جامعة الملك عبدالله",
    "جامعة الأمير سطام بن عبدالعزيز", "جامعة الأمير مقرن", "جامعة الأمير محمد بن فهد",
    "جامعة الإمام محمد بن سعود الإسلامية", "جامعة الإمام عبدالرحمن بن فيصل",
    "جامعة طيبة", "جامعة القصيم", "جامعة الطائف", "جامعة تبوك",
    "جامعة حائل", "جامعة جازان", "جامعة نجران", "جامعة الجوف",
    "جامعة الحدود الشمالية", "جامعة الباحة", "جامعة بيشة",
    "جامعة شقراء", "جامعة المجمعة", "جامعة حفر الباطن",
    "جامعة الأميرة نورة بنت عبدالرحمن", "جامعة الملك سعود بن عبدالعزيز للعلوم الصحية",
    "جامعة عفت", "جامعة الفيصل", "جامعة اليمامة",
    "كلية البترجي", "كلية ابن سينا", "كلية الأمير سلطان",
]

SAUDI_MAJORS = {
    "medical": ["طب", "طب بشري", "طب عام", "طب أسنان", "صيدلة", "صيدلة إكلينيكية", "تمريض"],
    "engineering": ["هندسة", "هندسة مدنية", "هندسة كهربائية", "هندسة ميكانيكية",
                    "هندسة كيميائية", "هندسة صناعية", "هندسة حاسوب", "هندسة برمجيات"],
    "science": ["علوم", "فيزياء", "كيمياء", "أحياء", "رياضيات", "إحصاء",
                "علوم حاسب", "تقنية معلومات", "نظم معلومات"],
    "humanities": ["قانون", "محاسبة", "إدارة أعمال", "اقتصاد", "علوم سياسية",
                   "لغة عربية", "لغة إنجليزية", "تربية", "خدمة اجتماعية"],
}

CUTOFF_PATTERNS = [
    r"(\d{2}(?:\.\d{1,2})?)\s*[%٪]",
    r"نسبة\s*(?:القبول)?\s*(\d{2}(?:\.\d{1,2})?)",
    r"(\d{2}(?:\.\d{1,2})?)\s*درجة",
    r"معدل\s*(?:القبول)?\s*(\d{2}(?:\.\d{1,2})?)",
    r"(\d{2}(?:\.\d{1,2})?)\s*%",
]


async def extract_and_seed(session: AsyncSession) -> dict[str, int]:
    """Seed known universities and majors, then run extraction."""
    results: dict[str, int] = {"universities": 0, "majors": 0, "cutoffs": 0, "faqs": 0}

    # 1. Seed universities
    for name in SAUDI_UNIVERSITIES:
        existing = await session.execute(
            select(AdmissionUniversity).where(AdmissionUniversity.name_ar == name)
        )
        if not existing.scalar_one_or_none():
            session.add(AdmissionUniversity(name_ar=name))
            results["universities"] += 1

    # 2. Seed majors
    for category, names in SAUDI_MAJORS.items():
        for name in names:
            existing = await session.execute(
                select(AdmissionMajor).where(AdmissionMajor.name_ar == name)
            )
            if not existing.scalar_one_or_none():
                session.add(AdmissionMajor(name_ar=name, category=category))
                results["majors"] += 1

    await session.commit()

    # 3. Run cutoff extraction
    cutoff_count = await extract_cutoffs(session)
    results["cutoffs"] = cutoff_count

    return results


async def extract_cutoffs(session: AsyncSession) -> int:
    """Extract cutoff values from messages that mention university + major + percentage."""
    scraper = ScraperService(session)
    count = 0

    # Get all seed universities
    unis = (await session.execute(select(AdmissionUniversity))).scalars().all()
    majors = (await session.execute(select(AdmissionMajor))).scalars().all()

    for uni in unis:
        for major in majors[:5]:
            ts_query = func.plainto_tsquery("arabic", f"{uni.name_ar} {major.name_ar}")
            matching_messages = await session.execute(
                select(ScrapedMessage)
                .where(ScrapedMessage.search_vector.op("@@")(ts_query))
                .where(ScrapedMessage.message_text.isnot(None))
                .order_by(desc(ScrapedMessage.message_date))
                .limit(20)
            )
            msgs = matching_messages.scalars().all()

            for msg in msgs:
                text = msg.message_text or ""
                for pattern in CUTOFF_PATTERNS:
                    match = re.search(pattern, text)
                    if match:
                        value = float(match.group(1))
                        if 50.0 <= value <= 100.0:
                            year = _extract_year(text, msg.message_date)
                            existing_cutoff = await session.execute(
                                select(AdmissionCutoff).where(
                                    AdmissionCutoff.university_id == uni.id,
                                    AdmissionCutoff.major_id == major.id,
                                    AdmissionCutoff.year == year,
                                    AdmissionCutoff.value == value,
                                )
                            )
                            if not existing_cutoff.scalar_one_or_none():
                                session.add(AdmissionCutoff(
                                    university_id=uni.id,
                                    major_id=major.id,
                                    year=year,
                                    value=value,
                                    source_message_id=msg.message_id,
                                    source_group_id=msg.tg_group_id,
                                ))
                                count += 1
                                if count >= 500:
                                    await session.commit()
                                    return count
                            break
            await session.commit()

    await session.commit()
    return count


def _extract_year(text: str, msg_date: datetime | None) -> int:
    """Extract year from message text, falling back to message date year."""
    year_match = re.search(r"\b(20\d{2})\b", text)
    if year_match:
        year = int(year_match.group(1))
        if 2020 <= year <= 2030:
            return year
    if msg_date:
        return msg_date.year
    return 2026


async def extract_faqs(session: AsyncSession, group_id: int | None = None) -> int:
    """Extract common Q&A patterns from admission messages."""
    scraper = ScraperService(session)
    count = 0

    faq_triggers = [
        "ما هي", "ما هو", "هل", "كيف", "كم", "متى", "وش", "أيش",
        "ماهي", "ماهو", "هل فيه", "هل يوجد", "كيفية",
        "هل تقبل", "هل يشترط", "هل لازم", "هل يجب",
    ]

    for trigger in faq_triggers:
        ts_query = func.plainto_tsquery("arabic", trigger)
        stmt = (
            select(ScrapedMessage)
            .where(ScrapedMessage.search_vector.op("@@")(ts_query))
            .where(ScrapedMessage.message_text.isnot(None))
            .where(func.length(ScrapedMessage.message_text) >= 20)
            .where(func.length(ScrapedMessage.message_text) <= 300)
        )
        if group_id:
            stmt = stmt.where(ScrapedMessage.tg_group_id == group_id)
        stmt = stmt.order_by(desc(ScrapedMessage.message_date)).limit(10)

        msgs = (await session.execute(stmt)).scalars().all()
        for msg in msgs:
            text = msg.message_text or ""
            if text.endswith("?"):
                existing = await session.execute(
                    select(AdmissionFAQ).where(AdmissionFAQ.question == text)
                )
                existing_faq = existing.scalar_one_or_none()
                if existing_faq:
                    existing_faq.frequency += 1
                else:
                    session.add(AdmissionFAQ(
                        question=text,
                        answer="",
                        source_group_id=msg.tg_group_id,
                    ))
                    count += 1

    await session.commit()
    return count


async def get_university_major_counts(session: AsyncSession) -> dict[str, int]:
    """Return counts of extracted entities."""
    return {
        "universities": (await session.execute(select(func.count(AdmissionUniversity.id)))).scalar() or 0,
        "majors": (await session.execute(select(func.count(AdmissionMajor.id)))).scalar() or 0,
        "cutoffs": (await session.execute(select(func.count(AdmissionCutoff.id)))).scalar() or 0,
        "faqs": (await session.execute(select(func.count(AdmissionFAQ.id)))).scalar() or 0,
    }
