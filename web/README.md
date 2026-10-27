# AML Guardian investigation workbench

A connected Next.js App Router / React / TypeScript / MUI interface backed by the existing Python/LangGraph workflow through a local FastAPI service.

## Run locally

Prerequisites: Python supported by the existing package, Node.js **24+**, npm, and two terminals.

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[web,dev]"
.venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
```

To narrate with the local model instead of the stub, start Ollama first (see the [local model setup](../README.md#optional-local-model-and-arena)) and run the API as:

```bash
AML_LLM_PROVIDER=ollama .venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
```

Browser checks (`npm run test:e2e`) start their own API in stub mode for speed and determinism; if they reuse an Ollama-backed API they still pass, but slower.

In a second terminal:

```bash
cd web
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Use that same hostname consistently. For a production-mode local check, use `npm run build` followed by `npm start` instead of `npm run dev`.

The server-only `AML_API_URL` environment variable defaults to `http://127.0.0.1:8000`. It is never sent to the browser. Next.js proxies allowlisted case, runtime, story creation and policy-reference resources; there is no open proxy. POST requests require a matching browser Origin.

## Implemented first slice

- Responsive case queue with search, lifecycle filter, deep links and refresh.
- Four **fixed synthetic scenarios**: transfer pattern, routine transfer, illustrative screening and a moderate-score review case.
- **Story studio**: describe a situation in plain English, or let a red-team agent try to beat the rules over up to three rounds. The local model proposes a bounded recipe and a locked prediction; code clamps and builds the synthetic transactions; the same agent team decides; the UI shows prediction vs reality, code corrections and rule blind spots.
- **Policy assistant**: LangChain Core retrieval and Runnable composition, local-model passage selection, exact code-owned extracts with source metadata, optional read-only case context, explicit abstention and offline fallback. Seven original educational notes; not legal advice or approved bank policy.
- Actual Python graph execution in a bounded local thread pool.
- Overview with rule-derived score and incoming/outgoing transaction totals.
- Evidence ledger with findings, actual transaction input and source inspection.
- Read-only narrative with explicit stub labeling, or — with `AML_LLM_PROVIDER=ollama` — an **“AI writes, code verifies”** panel showing each model sentence, the facts it cites, whether the verifier accepted or excluded it (with reasons), model, attempts and latency. The environment note shows which narration runtime is active (`/api/runtime`).
- Public node-activity timeline and honest polling/connectivity state.
- Activity showcase with the actual visited specialist path, each node's contribution, evidence references and measured completed-node duration. Manual step inspection does not rerun or simulate execution.
- Scenario comparison using the most recent actual local run per fixture; unrun cases are labeled, not populated with invented results.
- Explicit initial, empty, missing-case, failed and stale-snapshot states.
- Beginner-friendly four-step journey, Previous/Continue navigation and plain-English outcome explanations.
- Actionable human handoff: queue count/filter, **Needs your decision** status, orange banner with **Go to decision**, evidence/draft navigation, validated action/name/rationale/checklist form, and recorded decision history.
- Expandable rule-score breakdown and explicit distinction between net flow and account balance.
- [Standalone beginner usage guide](public/usage-guide.html), served at `/usage-guide.html` and linked from the workspace. It explains all four fixtures, exact expected values, the current human-checkpoint endpoint, terminology and troubleshooting.
- MUI/Emotion App Router cache integration; no external fonts or image services.

## Deliberate boundaries

This is a **local, synthetic-data application slice**, not a production deployment.

- No authentication, tenancy or real customer input. Bind both processes to loopback; do not expose publicly.
- SQLite stores local case snapshots, events and graph checkpoints (`data/guardian.sqlite`, overridden with `AML_CHECKPOINT_DB`). Pending reviews and recorded outcomes survive API restarts; test-data reset explicitly removes them. This is not a compliant or tamper-proof audit system.
- Two concurrent graph workers and at most eight accepted pending/running jobs. Capacity errors are explicit.
- CLEAR closes automatically. Other recommendations pause for a typed human decision; the workbench does **not** auto-approve cases.
- Review actions are simulated SAR approval, closure without further action, and escalation. A level-one screening HOLD only permits escalation. Level two requires a different self-declared name and a final approval/closure; further escalation is blocked. These checks are enforced by Python, but **names are not authenticated and seniority is not verified**.
- Narration is stubbed by default. The optional local Ollama model runs only on this machine; it writes wording only and never changes scores, recommendations or routing. See the [local model setup](../README.md#optional-local-model-and-arena).
- Retrieval is illustrative; citations and producer flags are not factual support verification.
- Screening uses the existing two-name example list, not live sanctions/PEP data.
- The browser uses case-event streaming with snapshot polling as well. Public events are not a compliant audit log.
- No draft editing, uploaded evidence, payment blocking or regulatory filing.
- Creation has no durable idempotency receipt yet. On lost submission response, inspect the refreshed queue before deliberate retry; never automatically retry creation.

## Human review: what to do and where

1. Open a case marked **Needs your decision**; the queue header can filter these cases.
2. Use the decision panel's **Understand the alert**, **Check the evidence** and **Read the draft** links. These navigate to the actual case content.
3. Click **Go to decision** in the orange banner to return to the form (keyboard focus follows).
4. Select an allowed action. Each option explains its consequence; blocked options explain the policy.
5. Enter a fictional reviewer name, an evidence-based rationale of 20–1000 normalized characters, and confirm the review checklist. The form explains any missing requirements.
6. Submit once. Escalation pauses for a second reviewer; final approval or closure produces **Workflow completed**, a disposition and decision history. Approval records intent only: nothing is filed.

The browser submits `POST /api/cases/{id}/decision`; the same-origin proxy validates the command and forwards it to `POST /api/v1/cases/{id}/decision`. Python validates again before resuming the graph. Policy errors are explicit; input remains available after a rejected submission. Duplicate or no-longer-pending decisions return 409 instead of applying another disposition.

## Validation

```bash
# Repository root
.venv/bin/python -m pytest tests -q

# web/
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
# Focused browser checks (use isolated services when sharing a workspace)
npx playwright test e2e/review.spec.ts --project=checks
```

## Test data and browser automation

Test data is **not** a hand-written database dump. The single source of truth is
[`tests/fixtures/synthetic-scenarios.json`](../tests/fixtures/synthetic-scenarios.json): the four
fixed scenarios with their expected account, score, recommendation, lifecycle, money totals and
exact agent route. Loading data means running each scenario through the **real** LangGraph
workflow, so seeded cases are identical to cases created in the UI. The same golden file is
asserted by pytest (`tests/test_test_data.py`) and by Playwright.

### 1. Enable the loader on the API (local only)

```bash
# Repository root
AML_ENABLE_TEST_DATA_CONTROLS=1 .venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
```

This flag exposes two API-only endpoints; without it they return 404. The browser-facing
Next.js proxy never forwards them.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/test-data/seed` `{"scenarios": [...], "reset": true}` | Optionally clear the queue, then run 1–8 fixed scenarios in order and wait for each to finish. |
| `DELETE /api/v1/test-data/cases` | Clear all cases (waits up to 10 s for running investigations; otherwise 409). |

### 2. Load or clear data from the command line

```bash
# web/
npm run test-data:seed                                   # replace queue with all four scenarios
node scripts/test-data.mjs seed --append review routine  # add specific scenarios, keep existing cases
npm run test-data:reset                                  # empty the queue
```

### 3. Run browser automation

Requires Google Chrome. Playwright **reuses** services already running on ports 8000/3000;
otherwise it starts both itself (API with the loader enabled, web via `build` + `start`).
If you reuse an API you started yourself, start it with the flag above.

```bash
# web/
npm run test:e2e      # 18 checks: golden seeded cases, journeys, accessibility, boundaries, policy, scenario catalog
npm run demo:e2e      # visible, narrated walkthrough of all four cases + comparison
npm run e2e:report    # open the HTML report (screenshots attached to each demo step)
```

Every run first resets and seeds the four scenarios (`e2e/global-setup.ts`), so tests start from
a known queue and never exhaust the 100-case session limit.

### User scenarios: pick, watch or run all

`e2e/scenarios/` holds 18 user-facing scenarios in five groups (investigation stories, the
multi-agent team, AI-designed stories, everyday use, safety and honesty). `e2e/scenarios/catalog.json` is the single
source for their titles, stories and checks; each test is tagged `@<id>`. Run them from the
repository root. `scenarios.sh` finds Node.js even when it is not on your `PATH`:

```bash
./scenarios.sh                                  # menu: choose scenarios, watch or not, speed, report
./scenarios.sh list                             # numbered list
./scenarios.sh run all                          # all 18, headless (~1 min stub, longer with local AI)
./scenarios.sh run sanctions-hold --watch       # watch one, with captions and Pause/Resume
./scenarios.sh run stories agents --watch --speed slow
./scenarios.sh run studio --watch               # story studio + red-team challenge
./scenarios.sh run 7 --model --report           # local AI if Playwright starts the API; open report
```

Inside `web/`, `npm run scenarios`, `scenarios:list`, `scenarios:all` and `scenarios:watch` do the
same. Every step attaches a screenshot to the HTML report. `ai-draft-verifier` checks the
"AI writes, code verifies" panel when the API runs a local model; otherwise it checks that the
draft is honestly labelled stub narration. After editing the catalog, regenerate the browsable
list with `npm run scenarios:page`, which writes `public/scenarios.html` (served at
`/scenarios.html`). A check in `test:e2e` fails if the catalog, specs and page disagree.

### Watching the demo: speed, pause and step-by-step

The demo browser shows a caption bar at the bottom explaining each step, with a
**❚❚ Pause / ▶ Resume** button. Pause holds the demo at the next step for as long as you
like (the demo has no time limit); the bar turns orange while paused. Screenshots hide the bar.

| Command | Pace |
| --- | --- |
| `npm run demo:slow` | ~5 s on each step, slow clicks — best for presenting |
| `npm run demo:e2e` | ~2.5 s on each step (default) |
| `npm run demo:fast` | no waiting — quick smoke run |
| `npm run demo:step` | Playwright Inspector: advance one action at a time with **Step over**, or **Resume** |

Fine-tune with `DEMO_HOLD_MS` (pause per step, ms) and `DEMO_SLOW_MO` (delay per click/typing
action, ms), for example `DEMO_HOLD_MS=8000 DEMO_SLOW_MO=1000 npm run demo:e2e`. Record video with
`DEMO_VIDEO=1` after `npx playwright install ffmpeg`. Set `PYTHON` if your interpreter is not
`../.venv/bin/python`.

To change a scenario's expected behaviour, update the golden file first; both pytest and
Playwright will then fail until the workflow and UI agree.

Playwright uses installed Chrome by default. For bundled Chromium, install the matching Playwright browser explicitly and use `PLAYWRIGHT_CHANNEL=chromium npm run test:e2e`. `WEB_BASE_URL` can override the local frontend URL. Browser tests create synthetic cases and consume the 100-case session budget; restart the API to reset it.

Browser tests cover the connected investigation, source inspection, route refresh, all four fixtures, responsive overflow, connection loss, hydration errors and automated accessibility. These are not a certification of WCAG compliance.

## Demonstrating the multi-agent workflow

1. Run each fixture once using New investigation.
2. Open Activity and inspect the actual path. Select a specialist to see its input responsibility, recorded output and source references.
3. Compare the CLEAR shortcut with the non-CLEAR critic/writer/human route. Screening HOLD preserves its override; the 40-point review fixture exercises the previously unrepresented REVIEW band.
4. Click Compare scenarios to inspect the latest results side by side and reopen a recorded run.

The graph is a sequential shared-state specialist workflow with conditional routing, not parallel autonomous agents. Per-node durations use `perf_counter` around actual node calls; the displayed total sums completed nodes and excludes orchestration, queue, network and browser overhead. A paused human node has no completed duration. No throughput, manual-time-saving, quality or live-model speed claim is inferred.

The beginner journey tests additionally cover sequential navigation, rule contributions, queue search/filter, the guide's mobile layout and automated accessibility. Backend tests verify the guide's expected scores and transaction totals against real graph output.

## Design and next slices

This showcase contains the runnable application, not the internal design and planning documents. Descriptions of future capabilities are not claims of completed implementation.

Next: durable cases/jobs/checkpoints, scoped identity, stable finding revisions, live-model grounding/evaluation, revision-bound human actions, then durable replay/streaming. Keep the current graph behavior stable until those contracts and policy changes are tested.
