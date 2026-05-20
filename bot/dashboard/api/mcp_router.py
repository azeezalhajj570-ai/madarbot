from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from bot.mcp.server import create_mcp_server

router = APIRouter(prefix="/mcp", tags=["mcp"])


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
            tools.append(
                {
                    "name": tool.name,
                    "description": tool.description or "",
                    "inputSchema": tool.parameters,
                }
            )
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": tools}}

    if method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        try:
            tool = next(t for t in server._tool_manager.list_tools() if t.name == tool_name)
            result = await tool.fn(**arguments)
            if isinstance(result, str):
                content_text = result
            else:
                content_text = json.dumps(result, default=str)
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
