from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.session import get_session
from bot.dashboard.api.dependencies import get_identity
from bot.services.admission_intelligence_service import AdmissionIntelligenceService
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


def _service(session: AsyncSession = Depends(get_session)) -> AdmissionIntelligenceService:
    return AdmissionIntelligenceService(session)


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
