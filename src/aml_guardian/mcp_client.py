"""Independent official-SDK smoke client; no server-to-server orchestration."""
from __future__ import annotations

import argparse
import asyncio
from contextlib import AsyncExitStack
from datetime import timedelta
import json
import logging
import math
import os
import sys
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client

from . import registry

logger = logging.getLogger(__name__)


def local_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        valid = (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")
                 and parsed.path == "/mcp" and not parsed.username and not parsed.password
                 and not parsed.query and not parsed.fragment and parsed.port is not None
                 and not any(ord(c) <= 32 for c in url))
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Use an explicit loopback HTTP URL, e.g. http://127.0.0.1:8765/mcp; no credentials/query.")
    return url


async def smoke(*, url: str | None = None, timeout: float = 15,
                parameters: StdioServerParameters | None = None) -> dict:
    if not math.isfinite(timeout) or not 0 < timeout <= 120:
        raise ValueError("Smoke timeout must be positive and at most 120 seconds.")
    if url and parameters:
        raise ValueError("Choose either HTTP URL or stdio parameters, not both.")
    if url:
        local_url(url)
    # The deadline covers initialization, discovery, every call and normal cleanup.
    async with asyncio.timeout(timeout), AsyncExitStack() as stack:
        if url:
            http = await stack.enter_async_context(httpx.AsyncClient(
                timeout=httpx.Timeout(timeout), trust_env=False))
            read, write, session_id = await stack.enter_async_context(
                streamable_http_client(url, http_client=http, terminate_on_close=True))
        else:
            params = parameters or StdioServerParameters(
                command=sys.executable, args=["-m", "aml_guardian.mcp_server"],
                env={**os.environ, "AML_TRACE_CONSOLE": "0"})
            read, write = await stack.enter_async_context(stdio_client(params))
            session_id = lambda: None
        session = await stack.enter_async_context(ClientSession(
            read, write, read_timeout_seconds=timedelta(seconds=timeout)))
        initialized = await session.initialize()
        listed = await session.list_tools()
        names = {tool.name for tool in listed.tools}
        if names != {tool["name"] for tool in registry.list_tools()}:
            raise ValueError("Guardian discovery did not return exactly the six expected read-only tools.")
        for tool in listed.tools:
            if not tool.annotations or tool.annotations.readOnlyHint is not True:
                raise ValueError(f"Tool lacks the expected read-only annotation: {tool.name}")
        calls = []
        for name in sorted(names):
            result = await session.call_tool(name, {"query": "cash deposits"})
            if result.isError or result.structuredContent is None:
                raise ValueError(f"Guardian tool call failed or omitted structured content: {name}")
            parsed = registry.ToolResult.model_validate(result.structuredContent)
            if parsed.tool != name:
                raise ValueError(f"Guardian returned incompatible evidence: {name}")
            calls.append(name)
        rejected = await session.call_tool("approve_case", {})
        if not rejected.isError:
            raise ValueError("Unknown/write-like tool was not rejected.")
        return {"status": "passed", "transport": "streamable-http" if url else "stdio",
                "server": initialized.serverInfo.name, "protocol_version": initialized.protocolVersion,
                "tools": sorted(names), "successful_calls": calls, "unknown_tool_rejected": True,
                "http_session_established": bool(session_id()) if url else False,
                "scope": "Fixed synthetic ACC-4471; no workbench access, approval or filing."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Existing loopback Streamable HTTP endpoint; default launches stdio child.")
    parser.add_argument("--timeout", type=float, default=15, help="Whole-smoke deadline, 0 < seconds <= 120.")
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 120:
        parser.error("--timeout must be positive and at most 120 seconds")
    if args.url:
        try:
            local_url(args.url)
        except ValueError as exc:
            parser.error(str(exc))
    try:
        report = asyncio.run(smoke(url=args.url, timeout=args.timeout))
    except TimeoutError:
        logger.error("MCP smoke timed out. Check the local server and increase --timeout up to 120 seconds.")
        return 1
    except Exception as exc:
        # SDK task groups may wrap network/protocol errors. Never log endpoints or payloads.
        logger.error("MCP smoke failed (%s). Check local service, package installation, transport and timeout.",
                     type(exc).__name__)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
