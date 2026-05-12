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
from bot.services.task_service import TaskService

_MAX_MESSAGE_TEMPLATE_LENGTH = 4096


def register_task_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_list_task_catalog() -> str:
        """List available task types with their config schemas. Use this first to know what fields each task supports."""
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            catalog = await service.list_catalog()
            result = success_response(
                content=f"Found {len(catalog)} task types in catalog",
                data={"catalog": catalog, "total": len(catalog)},
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_list_tasks(group_id: int | None = None, tg_group_id: int | None = None) -> str:
        """List active task assignments for a group. Provide group_id (internal) OR tg_group_id (Telegram ID)."""
        ctx = resolve_mcp_context()
        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                result = error_response(
                    content=f"Group with tg_group_id {tg_group_id} not found",
                    code="NOT_FOUND",
                    message=f"No accessible group found with tg_group_id={tg_group_id}",
                )
                return to_mcp_text(result)
        if not group_id:
            result = error_response(
                content="Missing group identifier",
                code="VALIDATION_ERROR",
                message="Either group_id or tg_group_id is required",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            try:
                tasks = await service.list_assignments(actor_user_id=ctx.actor_user_id, group_id=group_id)
                result = success_response(
                    content=f"Found {len(tasks)} active task{'s' if len(tasks) != 1 else ''}",
                    data={"tasks": tasks, "total": len(tasks)},
                )
                return to_mcp_text(result)
            except PermissionError as e:
                result = error_response(
                    content="Access denied",
                    code="ACCESS_DENIED",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),

    )
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
    ) -> str:
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
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)

        if not group_id and not tg_group_id:
            result = error_response(
                content="Missing group identifier",
                code="VALIDATION_ERROR",
                message="Either group_id or tg_group_id is required",
            )
            return to_mcp_text(result)
        if not task_key:
            result = error_response(
                content="Missing task_key",
                code="VALIDATION_ERROR",
                message="task_key is required",
            )
            return to_mcp_text(result)
        if not executor_type:
            result = error_response(
                content="Missing executor_type",
                code="VALIDATION_ERROR",
                message="executor_type is required (bot or agent)",
            )
            return to_mcp_text(result)

        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                result = error_response(
                    content=f"Group with tg_group_id {tg_group_id} not found",
                    code="NOT_FOUND",
                    message=f"No accessible group found with tg_group_id={tg_group_id}",
                )
                return to_mcp_text(result)

        valid_keys = _get_valid_task_keys()
        if task_key not in valid_keys:
            result = error_response(
                content=f"Invalid task_key: {task_key}",
                code="VALIDATION_ERROR",
                message=f"Valid keys: {sorted(valid_keys)}",
            )
            return to_mcp_text(result)
        if executor_type not in {"bot", "agent"}:
            result = error_response(
                content="Invalid executor_type",
                code="VALIDATION_ERROR",
                message="executor_type must be 'bot' or 'agent'",
            )
            return to_mcp_text(result)
        if executor_type == "agent" and agent_id is None:
            result = error_response(
                content="Missing agent_id",
                code="VALIDATION_ERROR",
                message="agent_id is required for agent tasks",
            )
            return to_mcp_text(result)

        config = config or {}
        for key in ("message_template", "ack_template"):
            template = config.get(key, "")
            if len(template) > _MAX_MESSAGE_TEMPLATE_LENGTH:
                result = error_response(
                    content=f"{key} too long",
                    code="VALIDATION_ERROR",
                    message=f"{key} exceeds {_MAX_MESSAGE_TEMPLATE_LENGTH} characters",
                )
                return to_mcp_text(result)

        inline_buttons = config.get("inline_buttons")
        if inline_buttons:
            if not isinstance(inline_buttons, list):
                result = error_response(
                    content="Invalid inline_buttons format",
                    code="VALIDATION_ERROR",
                    message="inline_buttons must be a list of {text, url} objects",
                )
                return to_mcp_text(result)
            for btn in inline_buttons:
                if not isinstance(btn, dict) or not btn.get("text") or not btn.get("url"):
                    result = error_response(
                        content="Invalid button format",
                        code="VALIDATION_ERROR",
                        message="Each inline button must have 'text' and 'url'",
                    )
                    return to_mcp_text(result)

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
                result = success_response(
                    content="Task created successfully",
                    data={"task": task},
                )
                return to_mcp_text(result)
            except (ValueError, PermissionError) as e:
                result = error_response(
                    content=f"Failed to create task: {e}",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_update_task(
        group_id: int | None = None,
        tg_group_id: int | None = None,
        assignment_id: str = "",
        enabled: bool | None = None,
        conditions: dict | None = None,
        config: dict | None = None,
    ) -> str:
        """Update an existing task. Provide group_id OR tg_group_id. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        result = error_response(
            content="Use madarbot_create_task with the same assignment_id to update",
            code="NOT_IMPLEMENTED",
            message="madarbot_create_task uses upsert behavior - call it with the same assignment_id to update",
        )
        return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),

    )
    async def madarbot_delete_task(group_id: int | None = None, tg_group_id: int | None = None, assignment_id: str = "", confirm: bool = False) -> str:
        """Delete a task assignment. Provide group_id OR tg_group_id. Requires confirmation and MCP_READONLY=false."""
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
        if not assignment_id:
            result = error_response(
                content="Missing assignment_id",
                code="VALIDATION_ERROR",
                message="assignment_id is required",
            )
            return to_mcp_text(result)
        if tg_group_id and not group_id:
            group_id = await _resolve_group_id(tg_group_id)
            if group_id is None:
                result = error_response(
                    content=f"Group with tg_group_id {tg_group_id} not found",
                    code="NOT_FOUND",
                    message=f"No accessible group found with tg_group_id={tg_group_id}",
                )
                return to_mcp_text(result)
        if not group_id:
            result = error_response(
                content="Missing group identifier",
                code="VALIDATION_ERROR",
                message="Either group_id or tg_group_id is required",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = TaskService(session, dispatch_agent_job=lambda **kw: None)
            try:
                deleted = await service.delete_assignment(
                    actor_user_id=ctx.actor_user_id,
                    group_id=group_id,
                    assignment_id=assignment_id,
                )
                result = success_response(
                    content="Task deleted successfully" if deleted else "Task not found",
                    data={"success": deleted, "assignment_id": assignment_id},
                )
                return to_mcp_text(result)
            except (ValueError, PermissionError) as e:
                result = error_response(
                    content=f"Failed to delete task: {e}",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)


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
