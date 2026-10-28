# AML Guardian Showcase

[![CI](https://github.com/chdurai/aml-guardian-showcase/actions/workflows/ci.yml/badge.svg)](https://github.com/chdurai/aml-guardian-showcase/actions/workflows/ci.yml)

A personal portfolio prototype for investigating **synthetic anti-money-laundering
alerts**, built with Python, LangGraph, FastAPI, Next.js, React, TypeScript and
Material UI.

**Review-only source:** inspection and unmodified local execution are permitted
for recruitment and technical assessment. Reuse, modification, redistribution
and production use require separate permission, subject to the exceptions in the
[license](LICENSE). Public visibility does not make this an open-source project.

**Models investigate and propose; deterministic policy code controls scores and
recommendations. Human decisions are simulated. Nothing is filed, no payments
are blocked, and no real customer data belongs in this application.**

This repository is a curated source snapshot with independent history.

## What you can explore

- Transaction-graph analysis with NetworkX and illustrative typology retrieval.
- Rule-based risk scoring and example-name screening.
- Evidence-linked narrative drafting, with a deterministic stub by default and
  optional local Ollama generation.
- An opt-in, bounded model-selected investigator using read-only tools.
- A workbench for cases, evidence, activity, narratives and recorded human review.
- SQLite persistence, restart recovery, SSE updates and polling fallback.
- Story Studio, an educational policy assistant and an optional synthetic
  Challenge Arena for inspecting evidence corrections.
- Shared typed tools exposed through Model Context Protocol (MCP).

## Run locally

Use Python **3.12** for the documented preflight/CI environment, Node.js **24+**
and npm. The Python package minimum is 3.11. Commands below use a macOS/Linux
shell; adapt virtual-environment paths on Windows.

**One command:**

```bash
git clone https://github.com/chdurai/aml-guardian-showcase.git
cd aml-guardian-showcase
./start.sh
```

The script installs missing Python/web dependencies (first run only), starts the
API and workbench, and opens the browser at **http://127.0.0.1:3000**. Ctrl+C
stops both services. `./start.sh --help` lists options (`--demo`, `--ollama`,
`--no-open`). The manual two-terminal setup:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e ".[web,dev]"
.venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
cd aml-guardian-showcase/web
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Use that hostname consistently. The web server's
`AML_API_URL` defaults to `http://127.0.0.1:8000`; it is server-only configuration.
For local production-mode verification use `npm run build` followed by
`npm start`, rather than the development server.

### A short demonstration

1. Create a fixed synthetic case from the workbench.
2. Inspect the transaction graph, evidence and deterministic recommendation.
3. For **Needs your decision**, select **Go to decision**.
4. Read the evidence/draft, choose an allowed action, enter a fictional reviewer
   name and rationale, and confirm the checklist.
5. Submit once and inspect the saved review history. A level-one screening HOLD
   requires escalation; a different self-declared reviewer completes level two.

The running application also includes user help at `/usage-guide.html`.
See [web setup and usage](web/README.md) for additional application details.

### Optional local model and Arena

The default stub needs no model account or API key. For local generation, install
and start Ollama separately and download the model explicitly:

```bash
ollama pull llama3.2:3b
AML_LLM_PROVIDER=ollama AML_ENABLE_INVESTIGATOR=1 AML_ENABLE_ARENA=1 \
  .venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
```

Open `/portfolio` or `/arena` for the optional Arena. Synthetic defects/outages
and saved scripted reports are labeled. No general model-quality or efficiency
improvement is claimed. Before an Arena presentation:

```bash
.venv/bin/python -m aml_guardian.preflight
```

Preflight checks the actual local dependencies and services; a dependency-only
check is not proof that the demo is ready. Keep graph feature flags consistent
when resuming persisted cases.

## Source reading route

| Area | Entry point |
|---|---|
| Workflow | [Graph](src/aml_guardian/graph.py) and [agents](src/aml_guardian/agents.py) |
| API and persistence | [API](src/aml_guardian/api.py) and [durability](src/aml_guardian/durability.py) |
| Human decision rules | [Review policy](src/aml_guardian/review.py) |
| Bounded tool use | [Investigator](src/aml_guardian/investigator.py) and [registry](src/aml_guardian/registry.py) |
| Browser application | [Workbench](web/src/app/workbench.tsx) |
| Synthetic acceptance data | [Fixtures](tests/fixtures/synthetic-scenarios.json) |
| Automated checks | [Python tests](tests/) and [browser tests](web/e2e/) |

## MCP configuration

The [integration templates](integrations/mcp/) are application configuration,
not personal or design documents. Replace
`/ABSOLUTE/PATH/TO/aml-guardian-showcase/.venv/bin/python` with your own executable.
The VS Code and Claude Desktop JSON shapes differ; use the matching file.

```bash
.venv/bin/python -m aml_guardian.mcp_server
# Optional loopback HTTP transport, in a separate terminal:
.venv/bin/python -m aml_guardian.mcp_server --transport streamable-http --port 8765
# Smoke-test an already running HTTP server:
.venv/bin/python -m aml_guardian.mcp_client --url http://127.0.0.1:8765/mcp
```

## Tests and checks

```bash
.venv/bin/python -m pytest tests -q
.venv/bin/ruff check src tests
.venv/bin/mypy
.venv/bin/python -m evals.run_evals
```

From `web/`:

```bash
npm run typecheck
npm test
npm run build
# Browser tests require Playwright's browser installation:
npx playwright install chromium
npx playwright test e2e/review.spec.ts --project=checks
```

CI runs the Python suite, lint/type checks and stub scenarios, plus frontend
type-checking, unit tests and a build. It does not certify production security or
live-model quality. Local evaluation reports are artifacts of their labeled
development runs, not regulatory validation.

## Important limitations

- **Local synthetic demo only.** Bind services to loopback. Do not expose this
  application publicly without a separate security/deployment review.
- Reviewer names are self-declared, not authenticated identities. A different-name
  rule is not enterprise four-eyes authorization.
- Screening is illustrative, not live sanctions/PEP coverage. Typology and policy
  retrieval are educational, not legal advice or approved bank policy.
- Local SQLite recovery is not distributed high availability, a compliant audit
  store or exactly-once processing.
- Submission idempotency is not fully implemented. Inspect the queue after an
  ambiguous creation response instead of automatically retrying.
- No regulatory filing, payment blocking, real KYC, document uploads or production
  approval authority is provided.
- Azure integration is not deployed by this snapshot.

Public source access does not mean a hosted application is available. This
showcase is not automatically synchronized with other development repositories.

## License

Current versions use the [AML Guardian Showcase Review-Only License](LICENSE).
It permits inspection and unmodified local evaluation for recruitment and
technical review, not incorporation into other projects, modification,
redistribution or production use without separate written permission.

GitHub's platform-required rights and third-party licenses remain applicable.
Earlier MIT-licensed versions retain their original permissions; this change
cannot revoke those grants or prevent downloading publicly accessible code.
Contact the repository owner for other uses.
