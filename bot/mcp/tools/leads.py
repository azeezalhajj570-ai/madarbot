from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    OUTPUT_SCHEMA_BASE,
    error_response,
    success_response,
    to_mcp_text,
)
from bot.services.agent_lead_service import AgentLeadService


def _serialize_lead(lead) -> dict:
    return {
        "id": lead.id,
        "agent_id": lead.agent_id,
        "group_id": lead.group_id,
        "tg_user_id": lead.tg_user_id,
        "username": lead.username,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "source_group_tg_id": lead.source_group_tg_id,
        "source_group_title": lead.source_group_title,
        "status": lead.status,
        "assigned_to": lead.assigned_to,
        "contact_info": lead.contact_info,
        "notes": lead.notes,
        "lead_label": lead.lead_label,
        "confidence": lead.confidence,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
    }


def register_lead_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_list_leads(
        agent_id: int | None = None,
        group_id: int | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> str:
        """List leads with optional filters."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            result_data = await service.list_leads(
                agent_id=agent_id,
                group_id=group_id,
                status=status,
                page=page,
                page_size=page_size,
            )
            leads = result_data.get("leads", [])
            result = success_response(
                content=f"Found {len(leads)} lead{'s' if len(leads) != 1 else ''}",
                data=result_data,
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_get_lead(lead_id: int) -> str:
        """Get a single lead by ID."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                lead = await service.get_lead(lead_id=lead_id)
                if int(lead.agent_id) != ctx.actor_user_id:
                    result = error_response(
                        content="Access denied",
                        code="ACCESS_DENIED",
                        message="You do not have permission to view this lead",
                    )
                    return to_mcp_text(result)
                result = success_response(
                    content=f"Lead: {lead.first_name or lead.username or lead.tg_user_id}",
                    data={"lead": _serialize_lead(lead)},
                )
                return to_mcp_text(result)
            except Exception as e:
                result = error_response(
                    content="Lead not found",
                    code="NOT_FOUND",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_update_lead_status(
        lead_id: int,
        status: str,
        notes: str | None = None,
    ) -> str:
        """Update lead status. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                lead = await service.update_lead(
                    lead_id=lead_id,
                    status=status,
                    notes=notes,
                )
                result = success_response(
                    content=f"Lead status updated to {status}",
                    data={"lead": _serialize_lead(lead)},
                )
                return to_mcp_text(result)
            except Exception as e:
                result = error_response(
                    content="Failed to update lead",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_add_lead_note(lead_id: int, note: str) -> str:
        """Add a note to a lead. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                existing = await service.get_lead(lead_id=lead_id)
                current_notes = existing.notes or ""
                new_notes = f"{current_notes}\n{note}" if current_notes else note
                lead = await service.update_lead(lead_id=lead_id, notes=new_notes)
                result = success_response(
                    content="Note added to lead",
                    data={"lead": _serialize_lead(lead)},
                )
                return to_mcp_text(result)
            except Exception as e:
                result = error_response(
                    content="Failed to add note",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),

    )
    async def madarbot_delete_lead(lead_id: int, confirm: bool = False) -> str:
        """Delete a lead. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        if not confirm:
            result = error_response(
                content="Confirmation required",
                code="CONFIRMATION_REQUIRED",
                message="Set confirm=true to proceed with deletion",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                deleted = await service.delete_lead(lead_id=lead_id)
                if deleted:
                    result = success_response(
                        content="Lead deleted successfully",
                        data={"success": True, "lead_id": lead_id},
                    )
                else:
                    result = error_response(
                        content="Lead not found",
                        code="NOT_FOUND",
                        message="No lead found with the given ID",
                    )
                return to_mcp_text(result)
            except Exception as e:
                result = error_response(
                    content="Failed to delete lead",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)
