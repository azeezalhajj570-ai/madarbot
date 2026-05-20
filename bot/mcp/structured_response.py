"""Structured response helpers for MCP tools."""

from __future__ import annotations

import json
from typing import Any

MCP_RESPONSE_VERSION = "1.0"
MCP_SOURCE = "madarbot-mcp"


def success_response(
    content: str,
    data: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "content": content,
        "structuredContent": {
            "data": data or {},
            "metadata": {
                "source": MCP_SOURCE,
                "version": MCP_RESPONSE_VERSION,
                **(metadata or {}),
            },
        },
    }


def error_response(
    content: str,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "content": content,
        "structuredContent": {
            "data": None,
            "error": {
                "code": code,
                "message": message,
                **(details or {}),
            },
        },
    }


def to_mcp_text(result: dict[str, Any]) -> str:
    return json.dumps(result, default=str)
