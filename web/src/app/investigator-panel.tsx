import { Chip } from "@mui/material";
import { Search } from "lucide-react";
import type { Investigator } from "@/lib/contracts";

const modes: Record<Investigator["mode"], { label: string; note: string }> = {
  model: { label: "Model-selected tools", note: "A model selected tool calls and evidence IDs. Code owns the tool results and copies exact evidence text into the summary; this is not a model-written conclusion." },
  scripted: { label: "Scripted · not AI", note: "A deterministic script selected these tools and evidence. No AI investigation is claimed." },
  fallback: { label: "Deterministic fallback", note: "The model path did not complete successfully. Deterministic tool choices or evidence selection provided a fallback; inspect the trace and errors below." },
  partial: { label: "Partial investigation", note: "The investigation is incomplete. Only the evidence returned so far is shown; missing evidence is not a clean result." },
};

export default function InvestigatorPanel({ report }: { report: Investigator }) {
  const mode = modes[report.mode];
  return <section className="panel section-panel investigator-panel" aria-labelledby="investigator-heading">
    <div className="section-heading"><span className="section-icon"><Search size={19} /></span>
      <div><h3 id="investigator-heading">Investigator trace</h3><p>Tool choices, exact evidence and visible limits</p></div>
      <Chip size="small" variant="outlined" label={mode.label} />
    </div>
    <p className="helper">{mode.note}</p>
    <dl className="investigator-stats">
      <div><dt>Configured model</dt><dd>{report.model || "None"}</dd></div>
      <div><dt>Total time</dt><dd>{report.latency_ms} ms</dd></div>
      <div><dt>Model calls</dt><dd>{report.model_calls}</dd></div>
      <div><dt>Invalid calls</dt><dd>{report.invalid_calls}</dd></div>
    </dl>
    <h4>Code-owned evidence summary</h4>
    <p className="helper">Exact returned evidence text, not an assessment of guilt, approval or filing readiness.</p>
    {report.summary.length ? <dl className="investigator-summary">{report.summary.map((fact, index) =>
      <div key={`${fact.id}-${index}`}><dt>{fact.id}</dt><dd>{fact.text}</dd></div>)}</dl>
      : <p className="helper">No evidence selected. This does not establish an absence of risk.</p>}
    <p className="helper">Selected evidence IDs: {report.selected_ids.join(", ") || "None"}</p>
    <details className="investigator-tools">
      <summary>Tool trace ({report.steps.length} calls)</summary>
      <ol>{report.steps.map((step, index) => <li key={index}>
        <h4>{step.tool}</h4>
        <p>Chosen by: {step.chosen_by === "model" ? "Model" : "Scripted (not AI)"} · {step.duration_ms} ms · {step.result_bytes} bytes returned</p>
        <h5>Arguments</h5><pre>{JSON.stringify(step.arguments, null, 2)}</pre>
        <h5>Returned evidence</h5>
        {step.facts.length ? <dl>{step.facts.map((fact, n) => <div key={`${fact.id}-${n}`}><dt>{fact.id}</dt><dd>{fact.text}</dd></div>)}</dl>
          : <p>No evidence returned.</p>}
      </li>)}</ol>
    </details>
    {report.errors.length > 0 && <div className="investigator-errors" role="note" aria-label="Investigator errors and rejected calls">
      <h4>Errors and rejected calls</h4><ul>{report.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
    </div>}
  </section>;
}
