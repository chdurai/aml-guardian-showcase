"use client";

import { useState } from "react";
import { Chip, Tooltip } from "@mui/material";
import { Check, ChevronRight, Cpu, ShieldCheck, X } from "lucide-react";
import type { Grounding, Runtime } from "@/lib/contracts";

export function modelLabel(model: string) {
  const known: Record<string, string> = { "llama3.2:3b": "Llama 3.2 3B", "phi4-mini": "Phi-4-mini", "granite3.3:2b": "Granite 3.3 2B" };
  return known[model] ?? model;
}

// The model sees untrusted names inside delimiters; people see them as quoted text.
export function readable(text: string) {
  return text.replace(/<<<\s*UNTRUSTED:\s*(.*?)\s*>{2,3}/g, "\u201c$1\u201d");
}

export function runtimeNote(runtime?: Runtime) {
  if (!runtime || runtime.provider === "stub") return "stub narration";
  if (runtime.provider !== "ollama") return `configured provider ${runtime.provider}: ${modelLabel(runtime.model)} (outbound model requests enabled)`;
  const who = runtime.publisher ? ` by ${runtime.publisher}` : "";
  const state = runtime.reachable === false ? " — not reachable, using verified fallback" : runtime.installed === false ? " — not installed, using verified fallback" : "";
  return `local model ${modelLabel(runtime.model)}${who} on this machine${state}`;
}

export default function GroundingPanel({ grounding }: { grounding: Grounding }) {
  const [showFacts, setShowFacts] = useState(false);
  const facts = new Map(grounding.facts.map(f => [f.id, f]));
  const fallback = grounding.mode === "fallback";
  return <section className="grounding" aria-label="AI writes, code verifies">
    <div className="grounding-head">
      <ShieldCheck size={18} />
      <div><strong>AI writes, code verifies</strong><p>{fallback
        ? `The configured model did not produce enough verifiable sentences${grounding.error ? ` (${grounding.error})` : ""}, so the narrative below is a deterministic template built only from verified facts.`
        : "The configured model wrote each sentence and cited the facts it relied on. Code then checked every sentence: cited facts must exist, every number must appear in them, and claims of guilt, filing, approval or contradiction with the score are excluded."}</p></div>
    </div>
    <div className="grounding-stats">
      <span><Cpu size={13} />{modelLabel(grounding.model)}</span>
      <span>{grounding.accepted} verified</span><span>{grounding.rejected + grounding.earlier_rejected.length} excluded</span>
      <span>{grounding.attempts} attempt{grounding.attempts === 1 ? "" : "s"}</span>
      <span>{(grounding.latency_ms / 1000).toFixed(1)} s</span>
      {grounding.output_tokens > 0 && <span>{grounding.output_tokens} tokens</span>}
    </div>
    {grounding.earlier_rejected.length > 0 && <>
      <h4 className="sentences-heading caught">Caught by the verifier in an earlier draft — the model was asked to rewrite</h4>
      <Sentences items={grounding.earlier_rejected} facts={facts} />
    </>}
    {grounding.sentences.length > 0 && <>
      <h4 className="sentences-heading">{fallback ? "Model sentences checked" : "Final draft, sentence by sentence"}</h4>
      <Sentences items={grounding.sentences} facts={facts} />
    </>}
    <button className="facts-toggle" aria-expanded={showFacts} onClick={() => setShowFacts(v => !v)}><ChevronRight size={14} />{showFacts ? "Hide" : "Show"} the {grounding.facts.length} verified facts the model was allowed to use</button>
    {showFacts && <dl className="grounding-facts">{grounding.facts.map(f => <div key={f.id}><dt>{f.id}</dt><dd><span>{f.agent.replaceAll("_", " ")}</span>{readable(f.text)}</dd></div>)}</dl>}
  </section>;
}

function Sentences({ items, facts }: { items: Grounding["sentences"]; facts: Map<string, Grounding["facts"][number]> }) {
  return <ol className="grounded-sentences">
    {items.map((s, i) => <li key={i} className={s.status}>
      <span className="sentence-mark" aria-label={s.status === "verified" ? "Verified" : "Excluded"}>{s.status === "verified" ? <Check size={13} /> : <X size={13} />}</span>
      <div><p>{s.text}</p>
        <div className="sentence-facts">{s.facts.map(id => <Tooltip key={id} title={readable(facts.get(id)?.text ?? "Unknown fact")}><Chip size="small" label={id} variant="outlined" /></Tooltip>)}
          {s.status === "rejected" && <span className="sentence-issues">Excluded: {s.issues.join("; ")}</span>}</div>
      </div>
    </li>)}
  </ol>;
}
