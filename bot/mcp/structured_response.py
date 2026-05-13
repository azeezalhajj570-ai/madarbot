"""Structured response helpers for MCP tools.

Provides outputSchema definitions and structuredContent response patterns
for ChatGPT Apps MCP compatibility.
"""

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
    """Create a structured success response.

    Args:
        content: Human-readable fallback response text.
        data: Structured result payload for ChatGPT Apps.
        metadata: Optional rendering or app-specific metadata.

    Returns:
        Dict matching the recommended MCP success response schema.
    """
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
    """Create a structured error response.

    Args:
        content: Human-readable fallback response text.
        code: Machine-readable error code (e.g., VALIDATION_ERROR, ACCESS_DENIED).
        message: Human-readable error message.
        details: Optional additional error context.

    Returns:
        Dict matching the recommended MCP error response schema.
    """
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
    """Serialize a structured response dict to JSON text for MCP text content."""
    return json.dumps(result, default=str)


OUTPUT_SCHEMA_BASE = {
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
            "description": "Human-readable fallback response",
        },
        "structuredContent": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                    "description": "Structured result payload for ChatGPT Apps",
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional rendering or app-specific metadata",
                },
                "error": {
                    "type": "object",
                    "description": "Optional structured error information",
                },
            },
        },
    },
    "required": ["content"],
}
