"use client";

import { useState } from "react";
import { Button } from "@mui/material";
import { ArrowRight, GitBranch, Layers3 } from "lucide-react";
import type { Case } from "@/lib/contracts";
import { executionSteps } from "@/lib/investigation";

const roles: Record<string, { title: string; input: string; job: string }> = {
  alert_intake: { title: "Intake", input: "Synthetic alert", job: "Identify the case and establish the shared investigation context." },
  entity_resolution: { title: "Entity research", input: "Originator and beneficiary names", job: "Extract parties and flag selected injection patterns; not full KYC verification." },
  graph_analysis: { title: "Transaction analyst", input: "Transactions and focal account", job: "Calculate graph connections, circular paths and rule indicators." },
  typology_rag: { title: "Guidance researcher", input: "Fixed structuring/funnel query plus alert type", job: "Retrieve passages from three illustrative snippets. The query is not dynamically selected by a model." },
  sanctions_screening: { title: "Screening specialist", input: "Extracted party names", job: "Apply the example two-name substring check; a hit sets internal HOLD." },
  risk_scoring: { title: "Policy scorer", input: "Graph metrics and screening state", job: "Compute the deterministic score or preserve HOLD. This is the routing authority." },
  investigator: { title: "Evidence investigator", input: "Case context and bounded evidence tools", job: "Record tool choices and returned evidence. The overview trace identifies model, scripted, fallback or partial operation; deterministic code retains scoring and routing authority." },
  evidence_critic: { title: "Evidence critic", input: "Accumulated findings and evidence IDs", job: "Challenge missing reference lists. It does not validate whether a passage proves a claim." },
  sar_drafter: { title: "Narrative writer", input: "Producer-marked findings and citation IDs", job: "A local US model drafts sentences that must cite verified facts; code rejects any unsupported number or claim and falls back to a fact template. CLEAR keeps fixed text." },
  hitl_approval: { title: "Human handoff", input: "Recommendation, score and draft", job: "Pause until a person records a code-validated decision: approve SAR filing, close, or escalate to a different senior reviewer (four-eyes)." },
  case_close: { title: "Workflow closure", input: "Recommendation and any recorded human decision", job: "Close the case: automatically for CLEAR, otherwise with the human disposition from the review step." },
};

export function routeExplanation(item: Case) {
  if (item.status === "running") return "Waiting for the scoring node to establish the route.";
  if (item.status === "failed") return "Execution failed. No successful route or completed handoff should be inferred.";
  if (item.recommendation === "CLEAR") return "CLEAR → fixed narrative → automatic closure. The evidence critic and human checkpoint are not visited on this route.";
  if (item.recommendation === "HOLD") return "Screening sets HOLD → scorer preserves the override → evidence critic → narrative → human checkpoint. No payment is blocked.";
  return `${item.recommendation === "REVIEW" ? "REVIEW (40–69)" : "FILE_SAR (70+)"} → evidence critic → narrative → human checkpoint. The recommendation is not a filed report.`;
}

export default function AgentShowcase({ item, inspect }: { item: Case; inspect: (reference: string) => void }) {
  const [selected, setSelected] = useState(0);
  const steps = executionSteps(item);
  const index = Math.min(selected, Math.max(steps.length - 1, 0));
  const step = steps[index];
  const role = step ? roles[step.start.node] : null;
  const measured = steps.reduce((sum, step) => sum + (step.end?.duration_ms ?? 0), 0);
  return <section className="agent-showcase panel" aria-labelledby="showcase-title">
    <div className="section-heading"><span className="section-icon"><GitBranch size={19} /></span><div><h3 id="showcase-title">How the specialists worked together</h3><p>Inspect the recorded run—not a simulated animation or hidden reasoning</p></div></div>
    <div className="route-explanation"><strong>Why this route?</strong><p>{routeExplanation(item)}</p></div>
    <div className="run-facts">
      <div><strong>{steps.length}</strong><span>steps entered</span></div>
      <div><strong>{item.findings.length}</strong><span>findings produced</span></div>
      <div><strong>{item.sources.length}</strong><span>passages retrieved</span></div>
      <div><strong>{measured.toFixed(2)} ms</strong><span>measured completed-node time</span></div>
    </div>
    <p className="helper">Timing is from this local run, excluding queue, framework, network and browser overhead. It is not a live-model benchmark or a measured improvement over manual work. Steps execute sequentially, with conditional routing—not in parallel.</p>
    <ol className="agent-path" aria-label="Actual agent execution path">{steps.map((entry, i) => <li key={entry.start.sequence}><button aria-current={i === index ? "step" : undefined} onClick={() => setSelected(i)}><span>{i + 1}</span>{roles[entry.start.node]?.title ?? entry.start.node}<small>{entry.end ? "Completed" : item.status === "failed" ? "Not completed" : entry.start.node === "hitl_approval" && item.status === "awaiting_human" ? "Paused here" : "In progress"}</small></button></li>)}</ol>
    {step && role ? <div className="agent-detail">
      <div className="agent-detail-heading"><h4>{index + 1}. {role.title}</h4><span>{step.end?.duration_ms != null ? `${step.end.duration_ms.toFixed(3)} ms · measured` : "No completion duration"}</span></div>
      <dl><dt>Receives</dt><dd>{role.input}</dd><dt>Responsibility</dt><dd>{role.job}</dd></dl>
      <h4>Recorded contribution</h4>
      {step.end ? <ul>{step.end.summary.map((claim, i) => <li key={i}>{claim}</li>)}</ul> : <p>{item.status === "failed" ? "This step did not return a successful result. See the case error." : step.start.node === "hitl_approval" && item.status === "awaiting_human" ? "The graph entered its human interrupt. No human decision has been recorded yet; use the decision panel at the top of the case." : "This node has started but has not returned yet."}</p>}
      {step.end?.evidence_ids.length ? <div className="citation-list">{step.end.evidence_ids.map(ref => <button key={ref} onClick={() => inspect(ref)}><Layers3 size={12} />{ref === item.graph_case_id ? "Alert / transactions" : ref === "sanctions" ? "Screening method" : ref}</button>)}</div> : null}
      <div className="agent-step-controls"><Button variant="outlined" disabled={index === 0} onClick={() => setSelected(index - 1)}>Previous agent</Button><span>Step {index + 1} of {steps.length}</span><Button variant="outlined" disabled={index === steps.length - 1} endIcon={<ArrowRight size={14} />} onClick={() => setSelected(index + 1)}>Next agent</Button></div>
    </div> : <p className="helper">Waiting for the first recorded step.</p>}
    <p className="helper">Selecting a step only changes the explanation you are viewing. It does not rerun the workflow. Shared case state carries prior findings, metrics and citations between these specialist role nodes.</p>
  </section>;
}
