from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    error_response,
    success_response,
    to_mcp_text,
)
from bot.services.admission_intelligence_service import AdmissionIntelligenceService


def register_admission_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_search_admissions(
        tg_group_id: int,
        query: str,
        university: str | None = None,
        major: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> str:
        """Search admission discussions in a scraped group. Uses full-text search + LLM synthesis to provide concise answers about university admission cutoffs, requirements, and applicant discussions."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            svc = AdmissionIntelligenceService(session)
            try:
                result = await svc.search_admissions(
                    tg_group_id=tg_group_id,
                    query=query,
                    university=university,
                    major=major,
                    date_from=date_from,
                    date_to=date_to,
                )
                resp = success_response(
                    content=result.get("answer_context", "No results"),
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content="Search failed",
                    code="SEARCH_ERROR",
                    message=str(e),
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_cutoff_trend(
        tg_group_id: int,
        university: str,
        major: str,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> str:
        """Extract and analyze admission cutoff percentage trends for a university/major from scraped group discussions. Returns rising/falling/stable trend with historical data points."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            svc = AdmissionIntelligenceService(session)
            try:
                result = await svc.cutoff_trend(
                    tg_group_id=tg_group_id,
                    university=university,
                    major=major,
                    date_from=date_from,
                    date_to=date_to,
                )
                resp = success_response(
                    content=result.get("summary", "No data"),
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content="Cutoff trend analysis failed",
                    code="CUTOFF_ERROR",
                    message=str(e),
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_analyze_student_concerns(
        tg_group_id: int,
    ) -> str:
        """Analyze student concerns from a scraped group's discussions. Clusters messages into concern topics (acceptance odds, registration, housing, major choice) and summarizes what applicants are worried about."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            svc = AdmissionIntelligenceService(session)
            try:
                result = await svc.student_concerns(tg_group_id=tg_group_id)
                topics = result.get("topics", [])
                resp = success_response(
                    content=f"Found {len(topics)} concern topic{'s' if len(topics) != 1 else ''}",
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content="Concern analysis failed",
                    code="CONCERN_ERROR",
                    message=str(e),
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_compare_universities(
        tg_group_id: int,
        university_a: str,
        university_b: str,
        major: str,
    ) -> str:
        """Compare admission cutoff trends between two universities for the same major. Returns side-by-side trend analysis from scraped group discussions."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            svc = AdmissionIntelligenceService(session)
            try:
                result = await svc.compare_universities(
                    tg_group_id=tg_group_id,
                    university_a=university_a,
                    university_b=university_b,
                    major=major,
                )
                resp = success_response(
                    content=f"Compared {university_a} vs {university_b} for {major}",
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content="University comparison failed",
                    code="COMPARE_ERROR",
                    message=str(e),
                ))
