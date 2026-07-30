from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.session import get_session
from bot.dashboard.api.dependencies import get_identity
from bot.services.admission_intelligence_service import AdmissionIntelligenceService
from bot.db.models import (
    AdmissionCutoff,
    AdmissionUniversity,
    AdmissionMajor,
    AdmissionFAQ,
)
from bot.services.admission_intelligence_layer import classify_intent, generate_suggestions
from bot.services.admission_intelligence_service import AdmissionIntelligenceService
from bot.services.admission_knowledge_service import (
    extract_and_seed,
    extract_faqs,
    get_university_major_counts,
)
from bot.services.admission_overview_service import AdmissionOverviewService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity

router = APIRouter(tags=["Admissions"])


class DiscussionSource(BaseModel):
    message: str
    date: str
    group: str = "admission_group"
    confidence: str


class SearchResponse(BaseModel):
    answer_context: str
    sources: list[DiscussionSource]
    total_matches: int = 0


class CutoffPoint(BaseModel):
    date: str
    value: float
    source: str


class CutoffTrendResponse(BaseModel):
    trend: str
    summary: str
    cutoff_history: list[CutoffPoint]


class ConcernTopic(BaseModel):
    name: str
    mentions: int
    examples: list[str]


class ConcernsResponse(BaseModel):
    topics: list[ConcernTopic]
    method: str = "keyword_clustering"


class UniversityProfile(BaseModel):
    name: str
    major: str
    cutoff: dict[str, Any]


class CompareResponse(BaseModel):
    universities: list[UniversityProfile]
    notes: str


class TrendingUniversity(BaseModel):
    name: str
    mention_count_7d: int = 0
    mention_count_1d: int = 0
    trend: str = "stable"


class HotTopic(BaseModel):
    topic: str
    mentions: int = 0
    trend: str = "stable"


class OverviewStats(BaseModel):
    messages_today: int = 0
    messages_this_week: int = 0
    active_groups: int = 0
    monitored_groups: int = 0


class OverviewResponse(BaseModel):
    stats: OverviewStats
    trending_universities: list[TrendingUniversity]
    hot_topics: list[HotTopic]
    last_updated: str = ""


class ActivityPoint(BaseModel):
    date: str
    message_count: int


class ActivityResponse(BaseModel):
    daily: list[ActivityPoint]


def _service(session: AsyncSession = Depends(get_session)) -> AdmissionIntelligenceService:
    return AdmissionIntelligenceService(session)


def _overview_service(request: Request, session: AsyncSession = Depends(get_session)) -> AdmissionOverviewService:
    redis: Redis | None = getattr(request.app.state, "redis", None)
    return AdmissionOverviewService(session, redis=redis)


@router.get("/api/admissions/overview", response_model=OverviewResponse)
async def get_admission_overview(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    return await svc.get_overview()


@router.get("/api/admissions/activity", response_model=ActivityResponse)
async def get_admission_activity(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    return await svc.get_activity()


@router.get("/api/admissions/trending-universities")
async def get_trending_universities(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    return await svc.get_trending_universities()


class UniversityInfo(BaseModel):
    name: str


class UniversitiesResponse(BaseModel):
    universities: list[str]
    total: int


class AdmissionLead(BaseModel):
    sender_user_id: int | None = None
    sender_name: str = ""
    message_text: str = ""
    signal: str = ""
    confidence: float = 0.0
    mentioned_universities: list[str] = []
    message_date: str = ""
    tg_group_id: int | None = None


class ExtractLeadsResponse(BaseModel):
    leads: list[AdmissionLead]
    total: int


class AdmissionNotification(BaseModel):
    id: str
    type: str  # 'lead', 'trending', 'alert'
    title: str
    description: str
    timestamp: str
    url: str = ""


class NotificationsResponse(BaseModel):
    notifications: list[AdmissionNotification]
    unread_count: int


@router.get("/api/admissions/universities", response_model=UniversitiesResponse)
async def list_universities(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    return await svc.get_universities()


@router.get("/api/admissions/extract-leads", response_model=ExtractLeadsResponse)
async def extract_admission_leads(
    hours_back: int = Query(24, description="Hours of history to scan"),
    min_confidence: float = Query(0.3, description="Minimum confidence threshold"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    return await svc.extract_admission_leads(hours_back=hours_back, min_confidence=min_confidence)


@router.get("/api/admissions/notifications", response_model=NotificationsResponse)
async def get_admission_notifications(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    overview = await svc.get_overview()
    alerts: list[AdmissionNotification] = []
    now = datetime.utcnow().isoformat()

    for uni in (overview.get("trending_universities") or []):
        if uni.get("trend") == "rising" and (uni.get("mention_count_1d") or 0) > 5:
            alerts.append(AdmissionNotification(
                id=f"trend-{uni.get('name', '')}",
                type="trending",
                title=f"{uni.get('name', 'Unknown')} is trending",
                description=f"{uni.get('mention_count_1d', 0)} mentions today",
                timestamp=now,
            ))

    leads_data = await svc.extract_admission_leads(hours_back=6, min_confidence=0.5)
    for lead in (leads_data.get("leads") or []):
        alerts.append(AdmissionNotification(
            id=f"lead-{lead.get('sender_user_id', '')}-{lead.get('message_date', '')}",
            type="lead",
            title=f"New lead: {lead.get('sender_name', 'Unknown')}",
            description=lead.get("message_text", "")[:120],
            timestamp=lead.get("message_date", now),
        ))

    return NotificationsResponse(notifications=alerts[:20], unread_count=len(alerts))


@router.post("/api/admissions/cache/refresh")
async def refresh_admission_cache(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionOverviewService = Depends(_overview_service),
):
    await svc.clear_cache()
    return {"status": "ok"}


@router.get("/api/admissions/search", response_model=SearchResponse)
async def search_admission_discussions(
    q: str = Query(..., description="Free-text query, e.g. 'نسبة القبول هندسة'"),
    university: str | None = Query(None),
    major: str | None = Query(None),
    tg_group_id: int = Query(..., description="Telegram group ID to search"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionIntelligenceService = Depends(_service),
):
    return await svc.search_admissions(
        tg_group_id=tg_group_id,
        query=q,
        university=university,
        major=major,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/api/admissions/cutoff-trend", response_model=CutoffTrendResponse)
async def get_cutoff_trend(
    university: str = Query(...),
    major: str = Query(...),
    tg_group_id: int = Query(..., description="Telegram group ID"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionIntelligenceService = Depends(_service),
):
    return await svc.cutoff_trend(
        tg_group_id=tg_group_id,
        university=university,
        major=major,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/api/admissions/student-concerns", response_model=ConcernsResponse)
async def get_student_concerns(
    tg_group_id: int = Query(..., description="Telegram group ID"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionIntelligenceService = Depends(_service),
):
    return await svc.student_concerns(tg_group_id=tg_group_id)


@router.get("/api/admissions/compare-universities", response_model=CompareResponse)
async def compare_universities(
    university_a: str = Query(...),
    university_b: str = Query(...),
    major: str = Query(...),
    tg_group_id: int = Query(..., description="Telegram group ID"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    svc: AdmissionIntelligenceService = Depends(_service),
):
    return await svc.compare_universities(
        tg_group_id=tg_group_id,
        university_a=university_a,
        university_b=university_b,
        major=major,
    )


# ─── AI Intelligence Layer ───────────────────────────────────────────────────


class ClassifyResponse(BaseModel):
    intent: str
    reason: str
    entities: dict[str, Any] = {}


@router.get("/api/admissions/classify", response_model=ClassifyResponse)
async def classify_query(
    q: str = Query(..., description="User question"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    return await classify_intent(q, user_id=identity.user_id)


class SuggestionItem(BaseModel):
    label: str
    query: str


@router.get("/api/admissions/suggestions", response_model=list[SuggestionItem])
async def get_suggestions(
    identity: TelegramWebAppIdentity = Depends(get_identity),
    overview_svc: AdmissionOverviewService = Depends(_overview_service),
):
    try:
        overview = await overview_svc.get_overview()
        trending = overview.get("trending_universities", [])
        hot_topics = overview.get("hot_topics", [])
    except Exception:
        trending = []
        hot_topics = []
    return await generate_suggestions(trending, hot_topics)


# ─── Knowledge Endpoints ────────────────────────────────────────────────────


class KnowledgeOverviewResponse(BaseModel):
    universities: int
    majors: int
    cutoffs: int
    faqs: int


@router.get("/api/admissions/knowledge/overview", response_model=KnowledgeOverviewResponse)
async def knowledge_overview(
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    return await get_university_major_counts(session)


@router.post("/api/admissions/knowledge/extract")
async def knowledge_extract(
    group_id: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    result = await extract_and_seed(session)
    faq_count = await extract_faqs(session, group_id)
    result["faqs"] = faq_count
    return result


@router.get("/api/admissions/knowledge/universities")
async def knowledge_universities(
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    rows = (await session.execute(
        select(AdmissionUniversity).order_by(AdmissionUniversity.source_count.desc())
    )).scalars().all()
    return [
        {"id": u.id, "name_ar": u.name_ar, "name_en": u.name_en,
         "city": u.city, "source_count": u.source_count, "cutoff_count": 0}
        for u in rows
    ]


@router.get("/api/admissions/knowledge/majors")
async def knowledge_majors(
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    rows = (await session.execute(
        select(AdmissionMajor).order_by(AdmissionMajor.source_count.desc())
    )).scalars().all()
    return [
        {"id": m.id, "name_ar": m.name_ar, "name_en": m.name_en,
         "category": m.category, "source_count": m.source_count}
        for m in rows
    ]


@router.get("/api/admissions/knowledge/cutoffs")
async def knowledge_cutoffs(
    university_id: int | None = Query(None),
    major_id: int | None = Query(None),
    year: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
    identity: TelegramWebAppIdentity = Depends(get_identity),
):
    stmt = (
        select(AdmissionCutoff)
        .join(AdmissionUniversity, AdmissionCutoff.university_id == AdmissionUniversity.id)
        .join(AdmissionMajor, AdmissionCutoff.major_id == AdmissionMajor.id)
    )
    if university_id:
        stmt = stmt.where(AdmissionCutoff.university_id == university_id)
    if major_id:
        stmt = stmt.where(AdmissionCutoff.major_id == major_id)
    if year:
        stmt = stmt.where(AdmissionCutoff.year == year)
    stmt = stmt.order_by(AdmissionCutoff.year.desc(), AdmissionCutoff.value.desc())

    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": c.id,
            "university": c.university.name_ar if c.university else "",
            "major": c.major.name_ar if c.major else "",
            "year": c.year,
            "value": c.value,
            "confidence": c.confidence,
        }
        for c in rows
    ]
