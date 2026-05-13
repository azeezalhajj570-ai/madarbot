from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from bot.mcp.server import create_mcp_server
from bot.mcp.structured_response import success_response, error_response, OUTPUT_SCHEMA_BASE

router = APIRouter(prefix="/mcp", tags=["mcp"])

# Output schema definitions for each MCP tool
# These are exposed in tools/list for ChatGPT Apps compatibility
TOOL_OUTPUT_SCHEMAS: dict[str, dict[str, Any]] = {
    "madarbot_health": OUTPUT_SCHEMA_BASE,
    "madarbot_list_accounts": OUTPUT_SCHEMA_BASE,
    "madarbot_get_account": OUTPUT_SCHEMA_BASE,
    "madarbot_update_account": OUTPUT_SCHEMA_BASE,
    "madarbot_delete_account": OUTPUT_SCHEMA_BASE,
    "madarbot_list_visible_groups": OUTPUT_SCHEMA_BASE,
    "madarbot_get_group_members": OUTPUT_SCHEMA_BASE,
    "madarbot_start_group_sync": OUTPUT_SCHEMA_BASE,
    "madarbot_get_sync_status": OUTPUT_SCHEMA_BASE,
    "madarbot_get_member_messages": OUTPUT_SCHEMA_BASE,
    "madarbot_list_task_catalog": OUTPUT_SCHEMA_BASE,
    "madarbot_list_tasks": OUTPUT_SCHEMA_BASE,
    "madarbot_create_task": OUTPUT_SCHEMA_BASE,
    "madarbot_update_task": OUTPUT_SCHEMA_BASE,
    "madarbot_delete_task": OUTPUT_SCHEMA_BASE,
    "madarbot_list_notifications": OUTPUT_SCHEMA_BASE,
    "madarbot_mark_notifications_seen": OUTPUT_SCHEMA_BASE,
    "madarbot_get_unseen_count": OUTPUT_SCHEMA_BASE,
    "madarbot_list_leads": OUTPUT_SCHEMA_BASE,
    "madarbot_get_lead": OUTPUT_SCHEMA_BASE,
    "madarbot_update_lead_status": OUTPUT_SCHEMA_BASE,
    "madarbot_add_lead_note": OUTPUT_SCHEMA_BASE,
    "madarbot_delete_lead": OUTPUT_SCHEMA_BASE,
    "madarbot_get_analytics": OUTPUT_SCHEMA_BASE,
    "madarbot_get_safety_settings": OUTPUT_SCHEMA_BASE,
    "madarbot_update_safety_settings": OUTPUT_SCHEMA_BASE,
    "madarbot_get_subscription": OUTPUT_SCHEMA_BASE,
    "madarbot_list_subscriptions": OUTPUT_SCHEMA_BASE,
    "madarbot_grant_subscription": OUTPUT_SCHEMA_BASE,
    "madarbot_cancel_subscription": OUTPUT_SCHEMA_BASE,
}


@router.get("/")
async def mcp_get() -> JSONResponse:
    """ChatGPT sends a GET to verify the endpoint before connecting."""
    return JSONResponse(
        content={
            "jsonrpc": "2.0",
            "method": "initialize",
            "serverInfo": {"name": "madarbot-mcp", "version": "1.0.0"},
            "capabilities": {"tools": {}},
        }
    )


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/openid-configuration")
async def mcp_well_known() -> JSONResponse:
    return JSONResponse(content={})


@router.post("/")
async def mcp_endpoint(request: Request) -> JSONResponse:
    """MCP JSON-RPC endpoint for ChatGPT and other MCP clients."""
    body = await request.json()
    server = create_mcp_server()

    if isinstance(body, list):
        results = []
        for msg in body:
            result = await _handle_single_message(server, msg)
            results.append(result)
        return JSONResponse(content=results)

    result = await _handle_single_message(server, body)
    return JSONResponse(content=result)


async def _handle_single_message(server: Any, message: dict) -> dict:
    """Handle a single JSON-RPC message."""
    method = message.get("method")
    msg_id = message.get("id")
    params = message.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {"listChanged": False},
                    "resources": {"listChanged": False},
                    "prompts": {"listChanged": False},
                },
                "serverInfo": {"name": "madarbot", "version": "1.0.0"},
            },
        }

    if method == "tools/list":
        tools = []
        for tool in server._tool_manager.list_tools():
            tool_def = {
                "name": tool.name,
                "description": tool.description or "",
                "inputSchema": tool.parameters,
            }
            # Include outputSchema for ChatGPT Apps compatibility
            if tool.name in TOOL_OUTPUT_SCHEMAS:
                tool_def["outputSchema"] = TOOL_OUTPUT_SCHEMAS[tool.name]
            tools.append(tool_def)
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": tools}}

    if method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        try:
            tool = next(t for t in server._tool_manager.list_tools() if t.name == tool_name)
            result = await tool.fn(**arguments)

            # Check if result is already a structured response string
            # or if it's a dict that needs to be wrapped
            if isinstance(result, str):
                # Try to parse as JSON to check if it's already structured
                try:
                    parsed = json.loads(result)
                    if "content" in parsed and "structuredContent" in parsed:
                        # Already structured, return as text content
                        content_text = result
                    else:
                        # Plain JSON, wrap in structured format
                        content_text = json.dumps(
                            success_response(
                                content="Operation completed",
                                data=parsed,
                            ),
                            default=str,
                        )
                except json.JSONDecodeError:
                    # Not JSON, wrap as text
                    content_text = json.dumps(
                        success_response(
                            content=result,
                            data={},
                        ),
                        default=str,
                    )
            elif isinstance(result, dict):
                # Dict result, wrap in structured format
                if "error" in result and len(result) == 1:
                    # Error dict
                    content_text = json.dumps(
                        error_response(
                            content=result["error"],
                            code="TOOL_ERROR",
                            message=result["error"],
                        ),
                        default=str,
                    )
                else:
                    content_text = json.dumps(
                        success_response(
                            content="Operation completed",
                            data=result,
                        ),
                        default=str,
                    )
            else:
                content_text = json.dumps(
                    success_response(
                        content=str(result),
                        data={},
                    ),
                    default=str,
                )

            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": content_text}],
                },
            }
        except StopIteration:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": f"Tool '{tool_name}' not found"},
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32603, "message": str(e)},
            }

    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}}

    if method == "prompts/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"prompts": []}}

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"Method '{method}' not found"},
    }
