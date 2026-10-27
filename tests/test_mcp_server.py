import asyncio
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from aml_guardian import registry
from aml_guardian.demo import SAMPLE_ALERT
from aml_guardian.mcp_server import mcp


def test_mcp_tools_equal_registry():
    async def check():
        tools = await mcp.list_tools()
        assert {t.name for t in tools} == {s["name"] for s in registry.list_tools()}
        for tool in tools:
            assert tool.annotations.readOnlyHint is True
            result = await mcp.call_tool(tool.name, {"query": "structuring"})
            expected = registry.execute(tool.name, {"query": "structuring"}, SAMPLE_ALERT).model_dump()
            # FastMCP returns text + structured content for Pydantic tool outputs.
            assert result[1] == expected
    asyncio.run(check())


def test_real_stdio_handshake_and_calls():
    async def check():
        params = StdioServerParameters(
            command=sys.executable, args=["-m", "aml_guardian.mcp_server"],
            env={**os.environ, "AML_TRACE_CONSOLE": "0"})
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                assert len(listed.tools) == 6
                for name in ("graph_neighbours", "sanctions_screen", "search_typologies"):
                    result = await session.call_tool(name, {"query": "structuring"})
                    assert not result.isError
                    assert result.structuredContent == registry.execute(
                        name, {"query": "structuring"}, SAMPLE_ALERT).model_dump()
                rejected = await session.call_tool("approve_case", {})
                assert rejected.isError
    asyncio.run(check())
