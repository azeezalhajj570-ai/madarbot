#!/usr/bin/env python3
"""Entry point for the MadarBot MCP server.

Local stdio mode (for Claude Desktop / Cursor / OpenCode):
    MCP_ENABLED=true MCP_DEFAULT_ACTOR_USER_ID=123 python -m bot.run_mcp_server

HTTP/SSE mode (for remote testing):
    MCP_ENABLED=true MCP_DEFAULT_ACTOR_USER_ID=123 MCP_TRANSPORT=streamable-http python -m bot.run_mcp_server
"""
from __future__ import annotations

import argparse

from bot.mcp.server import create_mcp_server


def main() -> None:
    parser = argparse.ArgumentParser(description="MadarBot MCP Server")
    parser.add_argument("--transport", default="stdio", choices=["stdio", "streamable-http", "sse"], help="Transport type")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()

    server = create_mcp_server()
    server.run(transport=args.transport, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
