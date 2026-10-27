import "../arena/arena.css";

export default function Portfolio() {
  return <main className="arena-page">
    <nav><a href="/">Workbench</a><a href="/arena">Challenge Arena</a></nav>
    <h1>Evidence-first agentic engineering</h1>
    <p>A synthetic portfolio prototype, not a banking service. The model selects read-only tools;
      deterministic code owns every score and recommendation. Nothing is filed or approved.</p>
    <section className="arena-card" id="walkthrough">
      <h2>Five-minute guided demo</h2>
      <ol>
        <li>Open <a href="/arena">Challenge Arena</a>. Select Clean control (dev-01). Run comparison.
          Confirm required coverage and no hard-check challenges.</li>
        <li>Select Wrong number (dev-02). A deliberately planted count is rejected.
          Inspect original claim, graph-only follow-up, revision history and resolved evidence.</li>
        <li>Select Screening unavailable (dev-04). The injected outage remains unresolved;
          unavailable screening never means zero matches.</li>
        <li>Compare initial and follow-up tool counts at equal coverage. Scripted, fallback,
          partial and live-model results are labelled separately. Fixed policy checks are shared overhead.</li>
        <li>Inspect the role-filtered timeline and trace/evidence links. If services are down,
          use Load labelled saved report. That report is never played as live AI.</li>
      </ol>
    </section>
    <section className="arena-card" id="launch">
      <h2>Launch and preflight</h2>
      <p>Use Python 3.12 and Node 24+. Install only from the repository manifests.
        Start Ollama with llama3.2:3b already installed.</p>
      <pre>{`AML_ENABLE_ARENA=1 AML_LLM_PROVIDER=ollama AML_MODEL=llama3.2:3b \\
  .venv/bin/python -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port 8000
# In another terminal:
cd web
npm run build
npm run start
# From repository root:
.venv/bin/python -m aml_guardian.preflight`}</pre>
      <p>Preflight does not install anything, reset data, take ports or stop processes.
        For offline UX use AML_LLM_PROVIDER=stub; this is explicitly scripted, not an AI result.</p>
    </section>
    <section className="arena-card" id="architecture">
      <h2>Architecture and evidence</h2>
      <p>Next.js same-origin proxy → bounded FastAPI job → existing LangGraph investigator →
        shared typed registry → revisioned evidence ledger → deterministic critic → targeted correction.
        SQLite persists public projections; restarts mark incomplete measurements interrupted.</p>
      <ul>
        <li><a href="#launch">Live launch instructions</a> and <a href="#walkthrough">short case walkthrough</a></li>
        <li><a href="/arena-evaluation.json">Saved evaluation summary (measured run metadata)</a></li>
        <li><a href="/arena-saved.json">Saved comparison report (not live)</a></li>
        <li><a href="/usage-guide.html">Existing workbench usage guide</a></li>
      </ul>
      <p>These small frozen synthetic cases measure evidence workflow behavior, not detection
        effectiveness, legal correctness or production readiness. See the evaluation summary for
        exclusions, outages and whether the efficiency goal was met. No interview outcome is promised.</p>
    </section>
  </main>;
}
