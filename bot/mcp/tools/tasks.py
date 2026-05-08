from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.services.task_service import TaskService

_MAX_MESSAGE_TEMPLATE_LENGTH = 4096


def register_task_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_task_catalog() -> dict:
        """List available task types with their config schemas. Use this first to know what fields each task supports."""
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            catalog = await service.list_catalog()
            return {"catalog": catalog, "total": len(catalog)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_tasks(group_id: int | None = None, tg_group_id: int | None = None) -> dict:
        """List active task assignments for a group. Provide group_id (internal) OR tg_group_id (Telegram ID)."""
        ctx = resolve_mcp_context()
        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                return {"error": f"Group with tg_group_id {tg_group_id} not found or not accessible"}
        if not group_id:
            return {"error": "Either group_id or tg_group_id is required"}
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            try:
                tasks = await service.list_assignments(actor_user_id=ctx.actor_user_id, group_id=group_id)
                return {"tasks": tasks, "total": len(tasks)}
            except PermissionError as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_create_task(
        group_id: int | None = None,
        tg_group_id: int | None = None,
        task_key: str = "",
        executor_type: str = "",
        enabled: bool = True,
        conditions: dict | None = None,
        config: dict | None = None,
        agent_id: int | None = None,
        group_ids: list[int] | None = None,
    ) -> dict:
        """Create a task assignment. Provide group_id (internal) OR tg_group_id (Telegram ID like -100xxxx).

        Call madarbot_list_task_catalog first to see valid task_keys and config fields.
        Call madarbot_list_visible_groups to find the tg_group_id for your target group.

        Common task types:
        - reply_message: Auto-reply to messages. Config: message_template (required), reply_mode, reply_markup_type, inline_buttons, delete_after_seconds
        - welcome_flow: Welcome new members. Config: message_template (required), scheduled_follow_up_message, follow_up_delay_seconds
        - lead_capture: Capture leads. Config: ack_template (required), lead_label, ask_contact
        - escalation_alert: Alert on urgent messages. Config: message_template (required), escalation_reason
        - notify_destination: Forward messages to another chat. Config: message_template, destination (required), delivery_mode, suggested_reply_template

        Conditions example: {"rules": [{"key": "text_contains", "operator": "contains", "value": "help"}]}
        """
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}

        if not group_id and not tg_group_id:
            return {"error": "Either group_id or tg_group_id is required"}
        if not task_key:
            return {"error": "task_key is required"}
        if not executor_type:
            return {"error": "executor_type is required (bot or agent)"}

        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                return {"error": f"Group with tg_group_id {tg_group_id} not found or not accessible"}

        valid_keys = _get_valid_task_keys()
        if task_key not in valid_keys:
            return {"error": f"Invalid task_key: {task_key}. Valid keys: {sorted(valid_keys)}"}
        if executor_type not in {"bot", "agent"}:
            return {"error": "executor_type must be 'bot' or 'agent'"}
        if executor_type == "agent" and agent_id is None:
            return {"error": "agent_id is required for agent tasks"}

        config = config or {}
        for key in ("message_template", "ack_template"):
            template = config.get(key, "")
            if len(template) > _MAX_MESSAGE_TEMPLATE_LENGTH:
                return {"error": f"{key} exceeds {_MAX_MESSAGE_TEMPLATE_LENGTH} characters"}

        inline_buttons = config.get("inline_buttons")
        if inline_buttons:
            if not isinstance(inline_buttons, list):
                return {"error": "inline_buttons must be a list of {text, url} objects"}
            for btn in inline_buttons:
                if not isinstance(btn, dict) or not btn.get("text") or not btn.get("url"):
                    return {"error": "Each inline button must have 'text' and 'url'"}

        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            try:
                task = await service.save_assignment(
                    actor_user_id=ctx.actor_user_id,
                    group_id=group_id,
                    task_key=task_key,
                    executor_type=executor_type,
                    enabled=enabled,
                    conditions=conditions,
                    config=config,
                    agent_id=agent_id,
                    group_ids=group_ids,
                )
                return {"task": task}
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_update_task(
        group_id: int | None = None,
        tg_group_id: int | None = None,
        assignment_id: str = "",
        enabled: bool | None = None,
        conditions: dict | None = None,
        config: dict | None = None,
    ) -> dict:
        """Update an existing task. Provide group_id OR tg_group_id. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        return {"error": "Use madarbot_create_task with the same assignment_id to update (upsert behavior)"}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False))
    async def madarbot_delete_task(group_id: int | None = None, tg_group_id: int | None = None, assignment_id: str = "", confirm: bool = False) -> dict:
        """Delete a task assignment. Provide group_id OR tg_group_id. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        if not confirm:
            return {"error": "Confirmation required. Set confirm=true to proceed."}
        if not assignment_id:
            return {"error": "assignment_id is required"}
        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                return {"error": f"Group with tg_group_id {tg_group_id} not found or not accessible"}
        if not group_id:
            return {"error": "Either group_id or tg_group_id is required"}
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            try:
                result = await service.delete_assignment(
                    actor_user_id=ctx.actor_user_id,
                    group_id=group_id,
                    assignment_id=assignment_id,
                )
                return {"success": result}
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}


def _get_valid_task_keys() -> set[str]:
    try:
        from bot.automation.registry import build_default_registry
        registry = build_default_registry()
        return {d.key for d in registry.list()}
    except Exception:
        return set()


async def _resolve_group_id(tg_group_id: int) -> int | None:
    from bot.agents.service import AgentService
    from bot.mcp.context import resolve_mcp_context
    from bot.services.group_service import canonical_tg_group_id
    ctx = resolve_mcp_context()
    async with SessionLocal() as session:
        service = AgentService(session)
        agents = await service.list_all_active_agents(actor_user_id=ctx.actor_user_id)
        canonical = canonical_tg_group_id(int(tg_group_id))
        for agent in agents:
            memberships = await service.list_account_group_visibility(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent.id,
            )
            for m in memberships:
                if canonical_tg_group_id(int(m.tg_group_id)) == canonical:
                    return m.group_id
    return None
