from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from bot.config import get_settings
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


def _mcp_base_url() -> str:
    settings = get_settings()
    for url in (settings.dashboard_url, settings.webapp_url, settings.agents_webapp_url):
        if url:
            parts = url.rstrip("/").rsplit("/webapp", 1)
            return parts[0]
    return "https://madar.azeez-tech.com"


@router.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server() -> JSONResponse:
    settings = get_settings()
    if not settings.mcp_oauth_enabled:
        return JSONResponse(content={})
    base = _mcp_base_url()
    client_ids = settings.mcp_oauth_client_ids
    return JSONResponse(
        content={
            "issuer": base,
            "authorization_endpoint": f"{base}/mcp/auth/authorize",
            "token_endpoint": f"{base}/mcp/auth/token",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "code_challenge_methods_supported": ["S256", "plain"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["tools"],
            "client_id": client_ids[0] if client_ids else "madarbot",
        }
    )


@router.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource() -> JSONResponse:
    settings = get_settings()
    if not settings.mcp_oauth_enabled:
        return JSONResponse(content={})
    base = _mcp_base_url()
    return JSONResponse(
        content={
            "resource": f"{base}/mcp/",
            "scopes": ["tools"],
            "authorization_servers": [f"{base}/"],
        }
    )


@router.get("/.well-known/openid-configuration")
async def openid_configuration() -> JSONResponse:
    return JSONResponse(content={})


@router.post("/")
@router.post("")
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
                "outputSchema": tool.output_schema or {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"},
                        "data": {"type": "object"},
                        "metadata": {"type": "object"},
                    },
                },
            }
            tools.append(tool_def)
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
