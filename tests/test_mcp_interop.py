import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from time import monotonic, sleep

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
import pytest

from aml_guardian import mcp_client
from aml_guardian.mcp_server import build_server

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def http_server():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "aml_guardian.mcp_server", "--transport", "streamable-http",
         "--port", str(port)], cwd=ROOT, env={**os.environ, "AML_TRACE_CONSOLE": "1"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}/mcp"
    try:
        deadline = monotonic() + 10
        with httpx.Client(trust_env=False, timeout=.3) as client:
            while monotonic() < deadline:
                if process.poll() is not None:
                    pytest.fail("Owned MCP HTTP server exited before readiness")
                try:
                    if client.get(url).status_code == 406:
                        break
                except httpx.TransportError:
                    pass
                sleep(.03)
            else:
                pytest.fail("Owned MCP HTTP server not ready")
        yield url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        assert process.poll() is not None
        with socket.socket() as probe:
            assert probe.connect_ex(("127.0.0.1", port)) != 0


@pytest.mark.parametrize("template,root_key", [
    ("vscode.stdio.json", "servers"), ("claude-desktop.stdio.json", "mcpServers"),
])
def test_host_templates_real_stdio_calls(template, root_key, tmp_path):
    config = json.loads((ROOT / "integrations/mcp" / template).read_text())
    spec = config[root_key]["guardian"]
    assert config.keys() == {root_key}
    if root_key == "servers":
        assert spec.pop("type") == "stdio"
    else:
        assert "type" not in spec
    spec["command"] = spec["command"].replace(
        "/ABSOLUTE/PATH/TO/aml-guardian-showcase/.venv/bin/python", sys.executable)
    params = StdioServerParameters(**spec, cwd=str(tmp_path))
    result = asyncio.run(mcp_client.smoke(parameters=params))
    assert result["status"] == "passed"
    assert len(result["successful_calls"]) == 6
    assert result["unknown_tool_rejected"]


def test_stdio_console_tracing_cannot_pollute_protocol():
    params = StdioServerParameters(command=sys.executable, args=["-m", "aml_guardian.mcp_server"],
                                   env={**os.environ, "AML_TRACE_CONSOLE": "1"})
    result = asyncio.run(mcp_client.smoke(parameters=params))
    assert result["status"] == "passed"


def test_real_http_handshake_calls_and_session_cleanup(http_server):
    result = asyncio.run(mcp_client.smoke(url=http_server))
    assert result["http_session_established"]
    assert result["unknown_tool_rejected"]
    assert len(result["successful_calls"]) == 6
    cli = subprocess.run(
        [sys.executable, "-m", "aml_guardian.mcp_client", "--url", http_server, "--timeout", "10"],
        cwd=ROOT, capture_output=True, text=True, timeout=15)
    assert cli.returncode == 0, cli.stderr
    assert json.loads(cli.stdout)["transport"] == "streamable-http"

    async def check():
        async with httpx.AsyncClient(trust_env=False, timeout=5) as http:
            async with streamable_http_client(http_server, http_client=http) as (read, write, get_id):
                async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=5)) as session:
                    await session.initialize()
                    identity = get_id()
                    assert identity
                    invalid = await session.call_tool("graph_neighbours", {"query": "x" * 401})
                    assert invalid.isError
            # The SDK client sends DELETE at context exit; session must not survive.
            response = await http.post(http_server, headers={
                "mcp-session-id": identity, "Accept": "application/json, text/event-stream"},
                json={"jsonrpc": "2.0", "id": 99, "method": "tools/list"})
            assert response.status_code == 404
    asyncio.run(check())


def test_http_security_and_config(http_server):
    server = build_server()
    assert server.settings.host == "127.0.0.1"
    assert server.settings.transport_security.enable_dns_rebinding_protection
    template = json.loads((ROOT / "integrations/mcp/vscode.http.json").read_text())
    assert template["servers"]["guardian-http"] == {
        "type": "http", "url": "http://127.0.0.1:8765/mcp"}
    with httpx.Client(trust_env=False, timeout=5) as client:
        assert client.post(http_server, headers={"Host": "evil.invalid"}, json={}).status_code == 421
        assert client.post(http_server, headers={"Origin": "http://evil.invalid"}, json={}).status_code == 403


@pytest.mark.parametrize("url", [
    "http://0.0.0.0:8765/mcp", "http://example.com:8765/mcp", "https://127.0.0.1:8765/mcp",
    "http://user:password@127.0.0.1:8765/mcp", "http://127.0.0.1:8765/mcp?key=secret",
    "http://127.0.0.1/mcp", "http://127.0.0.1:8765/sse",
])
def test_nonlocal_or_unsafe_client_urls_rejected(url):
    with pytest.raises(ValueError, match="loopback"):
        asyncio.run(mcp_client.smoke(url=url))


def test_stdio_timeout_terminates_child(tmp_path):
    marker = tmp_path / "pid"
    code = ("import os,time,pathlib; "
            f"pathlib.Path({str(marker)!r}).write_text(str(os.getpid())); time.sleep(30)")
    params = StdioServerParameters(command=sys.executable, args=["-c", code])
    started = monotonic()
    with pytest.raises((TimeoutError, BaseExceptionGroup)):
        asyncio.run(mcp_client.smoke(parameters=params, timeout=.5))
    assert monotonic() - started < 10
    assert marker.exists(), "Owned child must have started for this lifecycle test"
    with pytest.raises(ProcessLookupError):
        os.kill(int(marker.read_text()), 0)


@pytest.mark.parametrize("arguments", [
    ["--transport", "sse"], ["--host", "0.0.0.0"], ["--port", "0"], ["--port", "65536"],
])
def test_server_rejects_unsupported_or_public_configuration(arguments):
    result = subprocess.run([sys.executable, "-m", "aml_guardian.mcp_server", *arguments],
                            cwd=ROOT, capture_output=True, text=True, timeout=5)
    assert result.returncode == 2
    assert "error:" in result.stderr


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), 121])
def test_client_timeout_validation(timeout):
    with pytest.raises(ValueError, match="timeout"):
        asyncio.run(mcp_client.smoke(timeout=timeout))


def test_cli_connection_failure_explicit():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    result = subprocess.run(
        [sys.executable, "-m", "aml_guardian.mcp_client", "--url", f"http://127.0.0.1:{port}/mcp",
         "--timeout", "2"], cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert not result.stdout
    assert "MCP smoke failed" in result.stderr
