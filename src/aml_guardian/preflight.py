"""Read-only demo readiness checks. Does not install, reset or stop anything."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def get(url: str):
    parsed = urllib.parse.urlsplit(url)
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Preflight probes local loopback services only.")
    try:
        with urllib.request.urlopen(url, timeout=4) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        raise ValueError(f"HTTP {exc.code}; check service flags and URL.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError("Not reachable; start the documented local service.") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-bin", help="Path to a Node 24+ executable; otherwise use PATH.")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--web", default="http://127.0.0.1:3000")
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="llama3.2:3b")
    parser.add_argument("--offline", action="store_true", help="Dependencies only; does NOT certify demo readiness.")
    args = parser.parse_args()
    failures = []

    def check(name, action):
        try:
            detail = action()
            print(f"PASS {name}: {detail}")
        except (ValueError, OSError, subprocess.SubprocessError, importlib.metadata.PackageNotFoundError) as exc:
            failures.append(name)
            print(f"FAIL {name}: {exc}")

    def python():
        if sys.version_info < (3, 12):
            raise ValueError("Use the project's Python 3.12 .venv.")
        return sys.version.split()[0]

    def dependencies():
        return ", ".join(f"{name}={importlib.metadata.version(name)}" for name in
                         ("langgraph", "fastapi", "uvicorn", "mcp", "opentelemetry-sdk", "pytest"))

    def node():
        executable = args.node_bin or shutil.which("node")
        if not executable:
            raise ValueError("Node missing on PATH. Use Node 24+ or --node-bin /absolute/path/to/node.")
        version = subprocess.run([executable, "--version"], check=True, capture_output=True, text=True).stdout.strip()
        if int(version.lstrip("v").split(".")[0]) < 24:
            raise ValueError("Node 24+ is required.")
        root = Path(__file__).resolve().parents[2]
        missing = [name for name in ("next", "typescript", "@playwright/test", "vitest", "zod")
                   if not (root / "web/node_modules" / name / "package.json").exists()]
        if missing:
            raise ValueError("Missing web dependencies: " + ", ".join(missing) + ". Run npm ci in web.")
        return version + "; web dependencies present"

    def model():
        _, body = get(args.ollama.rstrip("/") + "/api/tags")
        data = json.loads(body)
        if not isinstance(data, dict) or not isinstance(data.get("models"), list):
            raise ValueError("Ollama returned an incompatible model catalog.")
        names = [m.get("name") for m in data["models"] if isinstance(m, dict)]
        if args.model not in names:
            raise ValueError(f"Required model {args.model} missing; explicitly run ollama pull {args.model}.")
        return args.model

    def api():
        _, body = get(args.api.rstrip("/") + "/api/v1/arena/fixtures")
        data = json.loads(body)
        if not isinstance(data, list) or len(data) < 12:
            raise ValueError("Expected the versioned arena fixture catalog.")
        return "Arena enabled; synthetic fixture catalog available"

    def web():
        _, body = get(args.web.rstrip("/") + "/arena")
        if b"Challenge Arena" not in body:
            raise ValueError("Web service did not serve the Arena page.")
        _, proxy = get(args.web.rstrip("/") + "/api/arena/fixtures")
        data = json.loads(proxy)
        if not isinstance(data, list) or len(data) < 12:
            raise ValueError("Same-origin arena proxy is not ready.")
        return "Arena page and same-origin proxy ready"

    check("Python", python)
    check("Python dependencies", dependencies)
    check("Node and web dependencies", node)
    if args.offline:
        print("SKIPPED service checks: dependency-only mode, NOT a demo-ready result.")
    else:
        check("Ollama and required model", model)
        check("API readiness", api)
        check("Web readiness", web)
    if failures:
        print("NOT READY: " + ", ".join(failures))
        return 1
    print("DEPENDENCIES READY (services unchecked)" if args.offline else "LOCAL SYNTHETIC DEMO READY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
