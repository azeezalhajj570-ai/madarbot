from __future__ import annotations

from datetime import datetime

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    error_response,
    success_response,
    to_mcp_text,
)
from bot.services.campaign_service import CampaignService


def register_campaign_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_list_campaigns(
        agent_id: int,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> str:
        """List campaigns for an agent. Optionally filter by status (draft, active, paused, completed, cancelled)."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = CampaignService(session)
            try:
                result = await service.list_campaigns(
                    agent_id=agent_id,
                    status=status,
                    page=page,
                    page_size=page_size,
                )
                resp = success_response(
                    content=f"Found {result['total']} campaigns",
                    data=result,
                    metadata={"agent_id": agent_id, "page": page, "total": result["total"]},
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content=str(e),
                    code="LIST_ERROR",
                    message=f"Failed to list campaigns: {e}",
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),
    )
    async def madarbot_pause_campaign(agent_id: int, campaign_id: int) -> str:
        """Pause an active recurring campaign. The scheduler will skip it until resumed."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = CampaignService(session)
            try:
                campaign = await service.pause_campaign(
                    campaign_id=campaign_id,
                    agent_id=agent_id,
                )
                data = service._to_dict(campaign)
                resp = success_response(
                    content=f"Campaign '{campaign.name}' paused",
                    data=data,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content=str(e),
                    code="PAUSE_ERROR",
                    message=f"Failed to pause campaign: {e}",
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),
    )
    async def madarbot_resume_campaign(agent_id: int, campaign_id: int) -> str:
        """Resume a paused recurring campaign. The scheduler will pick it up again."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = CampaignService(session)
            try:
                campaign = await service.resume_campaign(
                    campaign_id=campaign_id,
                    agent_id=agent_id,
                )
                data = service._to_dict(campaign)
                resp = success_response(
                    content=f"Campaign '{campaign.name}' resumed",
                    data=data,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content=str(e),
                    code="RESUME_ERROR",
                    message=f"Failed to resume campaign: {e}",
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),
    )
    async def madarbot_run_campaign_now(agent_id: int, campaign_id: int) -> str:
        """Trigger an immediate run of a recurring campaign without waiting for the next scheduled time."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = CampaignService(session)
            try:
                result = await service.run_now(
                    campaign_id=campaign_id,
                    agent_id=agent_id,
                    actor_user_id=ctx.actor_user_id,
                )
                resp = success_response(
                    content=f"Campaign triggered — {result.get('jobs_created', 0)} jobs created",
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content=str(e),
                    code="RUN_NOW_ERROR",
                    message=f"Failed to run campaign: {e}",
                ))

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_campaign_recurrence_logs(
        agent_id: int,
        campaign_id: int,
        page: int = 1,
        page_size: int = 50,
    ) -> str:
        """View execution history for a recurring campaign. Shows when each run was triggered and its status."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = CampaignService(session)
            try:
                result = await service.get_recurrence_logs(
                    campaign_id=campaign_id,
                    agent_id=agent_id,
                    page=page,
                    page_size=page_size,
                )
                resp = success_response(
                    content=f"Found {result['total']} execution logs",
                    data=result,
                )
                return to_mcp_text(resp)
            except Exception as e:
                return to_mcp_text(error_response(
                    content=str(e),
                    code="LOGS_ERROR",
                    message=f"Failed to get recurrence logs: {e}",
                ))
