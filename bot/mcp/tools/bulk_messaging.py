from __future__ import annotations

from datetime import datetime

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.account_group_membership_service import AccountGroupMembershipService
from bot.agents.agent_job_service import AgentJobService
from bot.agents.jobs import GROUP_MEMBER_BROADCAST_JOB_TYPE
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context


def _serialize_job(job) -> dict:
    payload = dict(job.job_payload or {})
    progress = payload.pop("progress", None)
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "created_at": job.created_at.isoformat()
        if isinstance(job.created_at, datetime)
        else str(job.created_at),
        "updated_at": job.updated_at.isoformat()
        if isinstance(job.updated_at, datetime)
        else str(job.updated_at),
        "payload": payload,
        "progress": progress,
    }


def register_bulk_messaging_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    )
    async def madarbot_list_bulk_recipients(
        agent_id: int,
        tg_group_id: int,
        query: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        """List group members available for bulk messaging. Shows who has already been messaged."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AccountGroupMembershipService(session)
            try:
                result = await service.list_scraped_agent_group_members(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    tg_group_id=tg_group_id,
                    query=query,
                    page=page,
                    page_size=page_size,
                    exclude_bots=True,
                )
                return result
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
    )
    async def madarbot_send_bulk_message(
        agent_id: int,
        tg_group_id: int,
        message: str,
        threshold: int = 50,
        interval_seconds: float = 2.0,
        skip_bots: bool = True,
        selected_user_ids: list[int] | None = None,
    ) -> dict:
        """Send a bulk message to group members via the agent's Telegram account. Creates a background job with rate limiting. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = AgentJobService(session)
            try:
                job = await service.create_job(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
                    job_payload={
                        "source_group_id": tg_group_id,
                        "message": message,
                        "threshold": threshold,
                        "interval_seconds": interval_seconds,
                        "skip_bots": skip_bots,
                        "selected_user_ids": selected_user_ids or [],
                    },
                )
                return {"job_id": job.id, "status": "pending"}
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    )
    async def madarbot_list_bulk_jobs(agent_id: int, limit: int = 20) -> dict:
        """List bulk message broadcast jobs for an agent."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentJobService(session)
            try:
                jobs = await service.list_agent_jobs(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    limit=limit,
                )
                broadcast_jobs = [j for j in jobs if j.job_type == GROUP_MEMBER_BROADCAST_JOB_TYPE]
                return {
                    "jobs": [_serialize_job(j) for j in broadcast_jobs],
                    "total": len(broadcast_jobs),
                }
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    )
    async def madarbot_get_bulk_job(job_id: int) -> dict:
        """Get detailed status of a bulk message job including sending progress."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            from bot.db.models import AgentJob
            from sqlalchemy import select

            stmt = select(AgentJob).where(AgentJob.id == job_id)
            result = await session.execute(stmt)
            job = result.scalar_one_or_none()
            if job is None:
                return {"error": f"Job {job_id} not found"}
            if job.job_type != GROUP_MEMBER_BROADCAST_JOB_TYPE:
                return {"error": f"Job {job_id} is not a bulk message job (type: {job.job_type})"}
            from bot.agents.service import AgentService

            agent_service = AgentService(session)
            agent = await agent_service.get_agent(agent_id=job.agent_id)
            if agent is None:
                return {"error": "Agent not found"}
            await agent_service.ensure_agent_owner(agent, ctx.actor_user_id)
            return {"job": _serialize_job(job)}
