"""Read-only MCP adapter; stdio default, loopback HTTP explicitly opt-in."""
from __future__ import annotations

import argparse
import os
import sys

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from . import registry
from .demo import SAMPLE_ALERT

def _register(server, spec):
    def read(query: str = "") -> registry.ToolResult:
        return registry.execute(spec["name"], {"query": query}, SAMPLE_ALERT)
    server.add_tool(read, name=spec["name"], description=spec["description"],
                 annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False,
                                             idempotentHint=True, openWorldHint=False))


def build_server(port: int = 8765) -> FastMCP:
    if not 1 <= port <= 65535:
        raise ValueError("MCP HTTP port must be between 1 and 65535.")
    server = FastMCP("guardian-mcp", instructions=(
        "Educational synthetic AML tools. Read-only fixed sample account ACC-4471. "
        "No case mutation, live data access, approval or filing. Scores are demo rules."),
        host="127.0.0.1", port=port, streamable_http_path="/mcp")
    for spec in registry.list_tools():
        _register(server, spec)
    return server


mcp = build_server()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transport", choices=("stdio", "streamable-http"), default="stdio")
    parser.add_argument("--port", type=int, default=8765, help="Loopback HTTP port (default: 8765).")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if os.getenv("AML_TRACE_CONSOLE") == "1":
        print("MCP disables console tracing: stdout is reserved for the protocol.", file=sys.stderr)
    os.environ["AML_TRACE_CONSOLE"] = "0"
    build_server(args.port).run(transport=args.transport)


if __name__ == "__main__":
    main()
