import json
import sys
from types import SimpleNamespace

import pytest

from aml_guardian import preflight


WEB_PACKAGES = ("next", "typescript", "@playwright/test", "vitest", "zod")


@pytest.fixture
def web_dependencies(tmp_path, monkeypatch):
    monkeypatch.setattr(
        preflight, "__file__", str(tmp_path / "src" / "aml_guardian" / "preflight.py"),
    )
    for name in WEB_PACKAGES:
        package = tmp_path / "web" / "node_modules" / name / "package.json"
        package.parent.mkdir(parents=True, exist_ok=True)
        package.write_text("{}", encoding="utf-8")
    return tmp_path / "web" / "node_modules"


def test_preflight_live_read_only_probes(monkeypatch, capsys, web_dependencies):
    monkeypatch.setattr(sys, "argv", ["preflight", "--node-bin", "/node"])
    monkeypatch.setattr(preflight.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="v24.22.1"))
    urls = []
    def get(url):
        urls.append(url)
        if url.endswith("/api/tags"):
            return 200, json.dumps({"models": [{"name": "llama3.2:3b"}]}).encode()
        if url.endswith("/fixtures"):
            return 200, json.dumps([{}] * 12).encode()
        return 200, b"Challenge Arena"
    monkeypatch.setattr(preflight, "get", get)
    assert preflight.main() == 0
    assert len(urls) == 4
    assert "LOCAL SYNTHETIC DEMO READY" in capsys.readouterr().out


@pytest.mark.parametrize("missing", WEB_PACKAGES)
def test_preflight_missing_web_dependency(monkeypatch, capsys, web_dependencies, missing):
    (web_dependencies / missing / "package.json").unlink()
    monkeypatch.setattr(sys, "argv", ["preflight", "--node-bin", "/node", "--offline"])
    monkeypatch.setattr(
        preflight.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="v24.22.1"),
    )
    assert preflight.main() == 1
    output = capsys.readouterr().out
    assert f"Missing web dependencies: {missing}. Run npm ci in web." in output
    assert "DEPENDENCIES READY" not in output


def test_preflight_offline_dependencies(monkeypatch, capsys, web_dependencies):
    monkeypatch.setattr(sys, "argv", ["preflight", "--node-bin", "/node", "--offline"])
    monkeypatch.setattr(
        preflight.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="v24.22.1"),
    )
    def unexpected_probe(url):
        pytest.fail(f"Offline preflight must not probe {url}")
    monkeypatch.setattr(preflight, "get", unexpected_probe)
    assert preflight.main() == 0
    output = capsys.readouterr().out
    assert "DEPENDENCIES READY (services unchecked)" in output
    assert "LOCAL SYNTHETIC DEMO READY" not in output


def test_preflight_missing_node_and_outages(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["preflight"])
    monkeypatch.setattr(preflight.shutil, "which", lambda name: None)
    def failed(url):
        raise ValueError("Not reachable")
    monkeypatch.setattr(preflight, "get", failed)
    assert preflight.main() == 1
    output = capsys.readouterr().out
    assert "NOT READY" in output
    assert "Node missing" in output


def test_preflight_refuses_nonlocal_probe():
    with pytest.raises(ValueError, match="loopback"):
        preflight.get("https://example.com")
