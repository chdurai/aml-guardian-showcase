"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "@mui/material";
import { ArrowRight, BadgeCheck, CheckCircle2, CircleSlash, Hand, History, Lock, ShieldAlert, UserCheck } from "lucide-react";
import { z } from "zod";
import { Case, caseSchema, Decision, normalizeReviewText, ReviewAction, ReviewRecord } from "@/lib/contracts";

const icons: Record<ReviewAction, typeof BadgeCheck> = { APPROVE_SAR: BadgeCheck, DISMISS: CircleSlash, ESCALATE: ShieldAlert };
const steps = [
  { tab: "overview", title: "Understand the alert", hint: "Score and signals" },
  { tab: "evidence", title: "Check the evidence", hint: "Findings and sources" },
  { tab: "draft", title: "Read the draft", hint: "Narrative, not filed" },
] as const;

async function submit(id: string, decision: Decision) {
  const response = await fetch(`/api/cases/${encodeURIComponent(id)}/decision`, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ detail: z.string() }).safeParse(body);
    throw new Error(parsed.success ? parsed.data.detail : "The decision could not be recorded.");
  }
  return caseSchema.parse(body);
}

export function ActionNeededBanner({ item, onGo }: { item: Case; onGo: () => void }) {
  if (item.status !== "awaiting_human" || !item.review) return null;
  return <section className="action-banner" role="region" aria-label="Your action is needed">
    <span className="action-banner-icon"><Hand size={20} /></span>
    <div><strong>Your decision is needed · {item.review.role}</strong>
      <p>The agents have finished and paused. Nothing else will happen until a person records a decision below.</p></div>
    <Button variant="contained" color="warning" endIcon={<ArrowRight size={16} />} onClick={onGo}>Go to decision</Button>
  </section>;
}

export function ReviewTrail({ reviews, disposition }: { reviews: ReviewRecord[]; disposition?: string | null }) {
  if (!reviews.length && !disposition) return null;
  return <div className="review-trail" aria-label="Decision history">
    <h4><History size={15} />Decision history</h4>
    <ol>{reviews.map(r => <li key={`${r.level}-${r.recorded_at}`}>
      <span className={`trail-badge ${r.action.toLowerCase()}`}>Level {r.level}</span>
      <div><strong>{r.label}</strong> · {r.reviewer} · <time>{new Date(r.recorded_at).toLocaleString()}</time><p>“{r.rationale}”</p></div>
    </li>)}</ol>
    {disposition && <p className="trail-outcome"><CheckCircle2 size={15} />{disposition}</p>}
  </div>;
}

export default function ReviewPanel({ item, openTab }: { item: Case; openTab: (tab: "overview" | "evidence" | "draft") => void }) {
  const client = useQueryClient();
  const review = item.review;
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [checked, setChecked] = useState(false);
  const mutation = useMutation({
    mutationFn: (decision: Decision) => submit(item.id, decision),
    onSuccess: updated => {
      client.setQueryData(["case", item.id], updated);
      client.setQueryData<Case[]>(["cases"], current => current?.map(c => c.id === item.id ? updated : c));
      setAction(null); setRationale(""); setChecked(false);
    },
  });

  if (item.status === "completed" && item.reviews.length)
    return <section id="decision" className="review-panel panel done" aria-label="Human decision">
      <div className="review-head"><span className="review-icon"><UserCheck size={20} /></span><div><h3>Human decision recorded</h3><p>This case is closed. The decision history below is the audit trail.</p></div></div>
      <ReviewTrail reviews={item.reviews} disposition={item.disposition} />
    </section>;
  if (item.status === "running" && item.reviews.length)
    return <section id="decision" className="review-panel panel" aria-label="Human decision"><p role="status">Recording the decision and resuming the workflow…</p><ReviewTrail reviews={item.reviews} /></section>;
  if (item.status !== "awaiting_human" || !review) return null;

  const chosen = review.options.find(o => o.action === action);
  const name = normalizeReviewText(reviewer);
  const reason = normalizeReviewText(rationale);
  const sameReviewer = review.previous?.reviewer.toLowerCase() === name.toLowerCase();
  const ready = Boolean(chosen?.allowed) && name.length >= 2 && reason.length >= 20 && checked && !sameReviewer;
  const missing = [!chosen && "choose an action", name.length < 2 && "enter your name", sameReviewer && "use a different senior reviewer", reason.length < 20 && `write ${20 - reason.length} more rationale characters`, !checked && "confirm the review checklist"].filter(Boolean);

  return <section id="decision" tabIndex={-1} className="review-panel panel" aria-labelledby="decision-title">
    <div className="review-head"><span className="review-icon pending"><Hand size={20} /></span><div>
      <span className="review-level">{review.role}</span>
      <h3 id="decision-title">Record your decision</h3>
      <p>{review.question}</p></div></div>
    <p className="helper">Local simulation only. Use a fictional reviewer name, not customer information. Names are self-declared, not authenticated roles. No report is filed and no payment is blocked.</p>

    {review.previous && <Alert severity="info" icon={<ShieldAlert size={18} />} className="review-previous">
      <strong>Escalated by {review.previous.reviewer}:</strong> “{review.previous.rationale}” You must be a different person to decide (four-eyes rule).
    </Alert>}

    <ol className="review-steps" aria-label="Before you decide">
      {steps.map((s, i) => <li key={s.tab}><button type="button" onClick={() => openTab(s.tab)}><span>{i + 1}</span><div><strong>{s.title}</strong><small>{s.hint}</small></div></button></li>)}
      <li className="current"><span>4</span><div><strong>Decide below</strong><small>Action, name, reason</small></div></li>
    </ol>

    <form aria-busy={mutation.isPending} onSubmit={e => { e.preventDefault(); if (ready && action && !mutation.isPending) mutation.mutate({ action, reviewer: name, rationale: reason, evidence_reviewed: true }); }}>
      <fieldset className="review-options"><legend>1. Choose an action</legend>
        {review.options.map(o => { const Icon = icons[o.action]; return <label key={o.action} className={`review-option ${o.action.toLowerCase()} ${action === o.action ? "selected" : ""} ${o.allowed ? "" : "blocked"}`}>
          <input type="radio" name="action" value={o.action} disabled={!o.allowed} checked={action === o.action} onChange={() => setAction(o.action)} />
          <span className="option-icon">{o.allowed ? <Icon size={18} /> : <Lock size={18} />}</span>
          <span><strong>{o.label}</strong><small>{o.allowed ? o.consequence : `Not available: ${o.blocked_reason}`}</small></span>
        </label>; })}
      </fieldset>

      <div className="review-fields">
        <label><span>2. Your name (recorded in the audit trail)</span><input value={reviewer} maxLength={60} onChange={e => setReviewer(e.target.value)} placeholder="e.g. Ana Analyst" autoComplete="off" /></label>
        <label><span>3. Why? Your rationale <small>{reason.length}/1000 · minimum 20</small></span><textarea value={rationale} maxLength={1000} rows={3} onChange={e => setRationale(e.target.value)} placeholder="Explain what in the evidence supports this decision." /></label>
      </div>

      <fieldset className="review-checklist"><legend>4. Confirm</legend>
        <ul>{review.checklist.map(c => <li key={c}>{c}</li>)}</ul>
        <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />I reviewed the evidence and the draft above.</label>
      </fieldset>

      {mutation.isError && <Alert severity="error" role="alert">{mutation.error.message}</Alert>}
      <div className="review-submit">
        <p>{ready ? `Ready: ${chosen?.label}. ${chosen?.consequence}` : `To continue: ${missing.join(", ")}.`}</p>
        <Button type="submit" variant="contained" disabled={!ready || mutation.isPending}>{mutation.isPending ? "Recording…" : chosen ? `Submit: ${chosen.label}` : "Submit decision"}</Button>
      </div>
    </form>
    <ReviewTrail reviews={item.reviews} />
  </section>;
}
