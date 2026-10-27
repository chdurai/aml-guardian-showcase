"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress } from "@mui/material";
import { BookOpen, ExternalLink } from "lucide-react";
import { z } from "zod";
import { type Case, policyAnswerSchema, recommendations } from "@/lib/contracts";

const examples = [
  "Do split deposits prove structuring?",
  "Does a wire above $10,000 require a CTR?",
  "Does a sanctions name match prove identity?",
  "Does report consideration mean a SAR was filed?",
  "Does CLEAR mean the customer is safe?",
];

export default function PolicyAssistant({ item }: { item?: Case }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [useCase, setUseCase] = useState(Boolean(item));
  const answer = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/policy", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), ...(useCase && item ? { case_id: item.id } : {}) }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ detail: z.string() }).safeParse(payload);
        throw new Error(error.success ? error.data.detail : "The policy assistant could not answer.");
      }
      return policyAnswerSchema.parse(payload);
    },
    retry: false,
  });
  const result = answer.data;
  const choose = (text: string) => { setQuestion(text); answer.reset(); };
  return <>
    <Button variant="outlined" startIcon={<BookOpen size={16} />} onClick={() => setOpen(true)}>Policy assistant</Button>
    <Dialog open={open} onClose={() => { if (!answer.isPending) setOpen(false); }} fullWidth maxWidth="md" aria-labelledby="policy-title">
      <DialogTitle id="policy-title"><span className="dialog-kicker">LANGCHAIN RETRIEVAL · SOURCE-FIRST LEARNING</span>Policy reference assistant</DialogTitle>
      <DialogContent>
        <p className="dialog-description">Ask what an indicator means. LangChain retrieves local educational notes, the local AI selects relevant passages, and code returns exact extracts with references—not unsupported AI advice.</p>
        <Alert severity="info">These are original learning notes, not approved bank policies or authoritative legal advice. External links point to background guidance, not verbatim sources for the notes. No score, route or case is changed.</Alert>
        <form className="policy-form" onSubmit={event => { event.preventDefault(); if (question.trim().length >= 5 && !answer.isPending) answer.mutate(); }}>
          <label htmlFor="policy-question" className="studio-label">Your policy-reference question</label>
          <textarea id="policy-question" rows={3} maxLength={400} value={question} disabled={answer.isPending} onChange={e => choose(e.target.value)} placeholder="e.g. Do split deposits prove structuring?" />
          <div className="studio-meta"><span>5–400 characters · synthetic information only</span><span>{question.length}/400</span></div>
          <div className="studio-examples" role="group" aria-label="Example reference questions">{examples.map(text => <button key={text} type="button" disabled={answer.isPending} onClick={() => choose(text)}>{text}</button>)}</div>
          {item ? <label className="policy-context-toggle"><input type="checkbox" checked={useCase} disabled={answer.isPending} onChange={e => { setUseCase(e.target.checked); answer.reset(); }} />Include selected synthetic case: {item.account}</label> : <p className="helper">General-reference mode. Open a finished investigation to include a case snapshot.</p>}
          {item && <button className="text-action" type="button" disabled={answer.isPending} onClick={() => { setUseCase(true); choose("What guidance relates to this case?"); }}>Try: What guidance relates to this case?</button>}
          <Button type="submit" variant="contained" disabled={answer.isPending || question.trim().length < 5}>Find references</Button>
        </form>
        {answer.isPending && <div role="status" className="policy-progress"><LinearProgress /><p>Retrieving notes and selecting references… The local model may take up to two minutes.</p></div>}
        {answer.error && <Alert severity="error" sx={{ mt: 2 }}>{answer.error.message} No automatic retry was performed.</Alert>}
        {result && <section className="policy-result" aria-label="Policy reference result" aria-live="polite">
          <div className="section-heading"><h3>{result.mode === "abstained" ? "No supported answer" : "Relevant reference extracts"}</h3><Chip size="small" label={result.mode === "model_selected" ? "AI-assisted · code-owned text" : result.mode === "extractive" ? "Extractive mode · no AI answer" : "Abstained"} /></div>
          <p><strong>Question:</strong> {result.question}</p>
          <p>{result.note}</p>
          {result.injection_flags > 0 && <Alert severity="warning">Instruction-like text was flagged and redacted. Pattern matching is not a complete injection defense; the model cannot supply answer text or change cases.</Alert>}
          {result.case_context && <div className="policy-snapshot"><strong>Case snapshot · separate from guidance</strong><p>{result.case_context.account} · Rule score {result.case_context.score}/100 · {result.case_context.recommendation ? recommendations[result.case_context.recommendation] : "No recommendation"}</p><p>Observed signals: {result.case_context.signals.join(", ") || "No listed pattern indicators"}. Related notes do not prove that any legal requirement applies.</p></div>}
          {result.passages.map(p => <article className="policy-passage" key={p.id}>
            <div><span className="support-label">{p.kind === "demo_rule_note" ? "Demo rule note" : "Educational summary"}</span><h4>[{p.id}] {p.title}</h4></div>
            <p className="helper">{p.id === result.retrieved[0]?.id ? "Top retrieval result · retained by code. " : ""}{result.mode !== "model_selected" ? "Ranked local reference · no model selection." : result.selected_ids.includes(p.id) ? "Selected by the local AI." : "Not selected by the local AI."}</p>
            <blockquote>{p.text}</blockquote>
            {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">Read background guidance <ExternalLink size={13} /></a> : <p className="helper">Source: this application&apos;s illustrative rules and limitations, not regulation.</p>}
          </article>)}
          <details><summary>How this answer was assembled</summary><ol>{result.trace.map((line, i) => <li key={i}>{line}</li>)}</ol><p>Corpus version: {result.corpus_version} · Model: {result.model}. Lexical ranking, not embeddings or legal-confidence scoring.</p><p>Retrieved candidates: {result.retrieved.map(p => p.id).join(", ") || "none"}.</p><p>AI-selected IDs: {result.selected_ids.join(", ") || "none"}.</p>{result.rejected_ids.length > 0 && <p>Rejected model references: {result.rejected_ids.join(", ")}.</p>}
            {result.retrieved.filter(p => !result.passages.some(selected => selected.id === p.id)).map(p => <article className="policy-candidate" key={p.id}><h4>Not selected · [{p.id}] {p.title}</h4><p>{p.text}</p>{p.url && <a href={p.url} target="_blank" rel="noopener noreferrer">Background guidance for {p.id} <ExternalLink size={13} /></a>}</article>)}
            {result.retrieved.length > result.passages.length && <p>The model may omit useful notes. These additional retrieved candidates remain available for inspection; their relevance has not been established.</p>}
          </details>
          <p className="helper">Extracts are copied exactly from curated local notes. This checks text provenance, not regulatory accuracy or completeness. No live regulatory updates are fetched.</p>
        </section>}
      </DialogContent>
      <DialogActions><Button disabled={answer.isPending} onClick={() => setOpen(false)}>Close</Button></DialogActions>
    </Dialog>
  </>;
}
