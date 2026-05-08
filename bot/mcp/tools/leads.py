from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
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

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_leads(
        agent_id: int | None = None,
        group_id: int | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict:
        """List leads with optional filters."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            result = await service.list_leads(
                agent_id=agent_id,
                group_id=group_id,
                status=status,
                page=page,
                page_size=page_size,
            )
            return result

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_lead(lead_id: int) -> dict:
        """Get a single lead by ID."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                lead = await service.get_lead(lead_id=lead_id)
                if int(lead.agent_id) != ctx.actor_user_id:
                    return {"error": "Access denied"}
                return {"lead": _serialize_lead(lead)}
            except Exception as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_update_lead_status(
        lead_id: int,
        status: str,
        notes: str | None = None,
    ) -> dict:
        """Update lead status. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                lead = await service.update_lead(
                    lead_id=lead_id,
                    status=status,
                    notes=notes,
                )
                return {"lead": _serialize_lead(lead)}
            except Exception as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_add_lead_note(lead_id: int, note: str) -> dict:
        """Add a note to a lead. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                existing = await service.get_lead(lead_id=lead_id)
                current_notes = existing.notes or ""
                new_notes = f"{current_notes}\n{note}" if current_notes else note
                lead = await service.update_lead(lead_id=lead_id, notes=new_notes)
                return {"lead": _serialize_lead(lead)}
            except Exception as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False))
    async def madarbot_delete_lead(lead_id: int, confirm: bool = False) -> dict:
        """Delete a lead. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        if not confirm:
            return {"error": "Confirmation required. Set confirm=true to proceed."}
        async with SessionLocal() as session:
            service = AgentLeadService(session)
            try:
                result = await service.delete_lead(lead_id=lead_id)
                return {"success": result}
            except Exception as e:
                return {"error": str(e)}
