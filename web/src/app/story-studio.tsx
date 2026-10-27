"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress } from "@mui/material";
import { ArrowRight, Bot, Check, Code2, Lock, ShieldAlert, Swords, Target, WandSparkles } from "lucide-react";
import type { Case, Runtime } from "@/lib/contracts";
import { recommendations } from "@/lib/contracts";
import { recipeSummary, storyVerdict } from "@/lib/investigation";
import { modelLabel } from "./grounding-panel";

export const storyExamples = [
  { label: "Split cash deposits", text: "Someone splits about $40,000 in cash into deposits just under $10,000 at different branches over a week." },
  { label: "Ordinary payment", text: "A small business receives one ordinary $2,500 payment from a regular client." },
  { label: "Many senders, one wire", text: "Money from eight different people lands in one account, then most of it leaves in a single round wire." },
  { label: "Money comes back", text: "Funds go out to a trading company and part of it comes back a few days later." },
  { label: "Screening-list company", text: "A payment is sent to a company that appears on the screening list." },
];

const pipeline = [
  { icon: Bot, title: "AI designs", text: "The local model turns your words into a small recipe." },
  { icon: Code2, title: "Code checks & builds", text: "Code clamps every value and generates synthetic transactions." },
  { icon: Lock, title: "Prediction locked", text: "The AI's expected outcome is saved before the run." },
  { icon: Target, title: "Team investigates", text: "The unchanged agent team decides with fixed rules." },
];

type Mode = "design" | "challenge";

export function StoryStudioDialog({ open, onClose, runtime, pending, error, submit }: {
  open: boolean; onClose: () => void; runtime?: Runtime; pending: boolean; error: string | null;
  submit: (mode: Mode, description: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("design");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) { setSeconds(0); return; }
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const offline = runtime ? runtime.provider !== "ollama" || runtime.reachable === false : false;
  const tooShort = mode === "design" && text.trim().length < 12;
  const progress = mode === "challenge"
    ? seconds < 12 ? "Red-team round 1: designing an evasion attempt…" : seconds < 24 ? "Round 2: learning from the rules that fired…" : "Round 3: last attempt, then the team investigates the best one…"
    : seconds < 6 ? "Story designer is reading your description…" : "Code is checking the recipe and building transactions…";

  return <Dialog open={open} onClose={() => { if (!pending) onClose(); }} fullWidth maxWidth="md" aria-labelledby="studio-title">
    <DialogTitle id="studio-title"><span className="dialog-kicker">STORY STUDIO · AI DESIGNS, CODE VERIFIES</span>Create a new practice story</DialogTitle>
    <DialogContent>
      <p className="dialog-description">Invent a situation in plain English—or let a red-team agent try to sneak money past the rules. Everything is synthetic; nothing is filed.</p>
      <ol className="studio-pipeline" aria-label="How a story becomes an investigation">{pipeline.map(({ icon: Icon, title, text: detail }, i) =>
        <li key={title}><span className="studio-step-icon"><Icon size={16} /></span><div><strong>{i + 1}. {title}</strong><small>{detail}</small></div></li>)}</ol>
      <fieldset className="studio-modes" disabled={pending}><legend className="sr-only">Story mode</legend>
        <label className={`scenario-option ${mode === "design" ? "selected" : ""}`}><input type="radio" name="studio-mode" checked={mode === "design"} onChange={() => setMode("design")} /><WandSparkles size={18} /><span><strong>Describe a story</strong><small>You write it; the AI designs it and predicts the outcome.</small></span>{mode === "design" && <Check size={18} />}</label>
        <label className={`scenario-option ${mode === "challenge" ? "selected" : ""}`}><input type="radio" name="studio-mode" checked={mode === "challenge"} onChange={() => setMode("challenge")} /><Swords size={18} /><span><strong>Challenge the team</strong><small>A red-team agent gets three tries to move $25,000+ without being caught.</small></span>{mode === "challenge" && <Check size={18} />}</label>
      </fieldset>
      {mode === "design" ? <div className="studio-story">
        <label htmlFor="story-text" className="studio-label">Your story in plain English</label>
        <textarea id="story-text" value={text} maxLength={400} rows={3} disabled={pending} onChange={e => setText(e.target.value)} placeholder="e.g. Someone splits cash into deposits just under $10,000 at different branches." />
        <div className="studio-meta"><span>{text.trim().length < 12 ? "At least 12 characters" : "Looks good"}</span><span>{text.length}/400</span></div>
        <div className="studio-examples" role="group" aria-label="Example stories"><span>Try an example:</span>{storyExamples.map(e => <button type="button" key={e.label} disabled={pending} className={text === e.text ? "active" : ""} onClick={() => setText(e.text)}>{e.label}</button>)}</div>
      </div> : <div className="studio-challenge"><ShieldAlert size={20} /><p>The red-team agent knows the published rule thresholds. After each try it sees which rules fired, adapts, and tries again (up to three rounds). Tries that move less than $25,000 do not count. The team then investigates its best attempt—and any blind spots are shown honestly.</p></div>}
      {offline && <Alert severity="info" sx={{ mt: 2 }}>The local model is not available, so a transparent deterministic designer will stand in. The rest of the flow is identical.</Alert>}
      {pending && <div className="studio-progress" role="status"><LinearProgress /><p>{progress} <span>{seconds}s</span></p><small>The local model runs on this laptop—this can take {mode === "challenge" ? "up to a minute or two" : "5–20 seconds"}. Please keep this window open.</small></div>}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error} No automatic retry was performed.</Alert>}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 3 }}>
      <Button disabled={pending} onClick={onClose}>Cancel</Button>
      <Button variant="contained" disabled={pending || tooShort} startIcon={mode === "challenge" ? <Swords size={16} /> : <WandSparkles size={16} />} onClick={() => submit(mode, mode === "design" ? text.trim() : "")}>
        {pending ? "Working…" : mode === "challenge" ? "Start the challenge" : "Design & investigate"}
      </Button>
    </DialogActions>
  </Dialog>;
}

const label = (value: keyof typeof recommendations) => recommendations[value];

export function StoryCard({ item }: { item: Case }) {
  const story = item.story;
  if (!story) return null;
  const verdict = storyVerdict(item);
  const challenge = story.mode === "challenge";
  const designer = story.designer === "model" ? `${modelLabel(story.model)} · ${(story.latency_ms / 1000).toFixed(1)}s` : "Deterministic designer";
  return <section className="panel section-panel story-card" aria-labelledby="story-title">
    <div className="section-heading"><span className="section-icon">{challenge ? <Swords size={19} /> : <WandSparkles size={19} />}</span><div><h3 id="story-title">{challenge ? "Red-team challenge" : "Story studio"} · {story.title}</h3><p>{challenge ? "An AI tried to evade the rules; the agent team investigated its best attempt." : "Your words, designed by AI, built and checked by code."}</p></div><Chip size="small" variant="outlined" label={designer} /></div>
    <div className={`story-verdict ${verdict.tone}`} role="status"><strong>{verdict.headline}</strong><p>{verdict.detail}</p></div>
    <div className="story-versus">
      <div><span className="story-label"><Lock size={12} /> {challenge ? "Red team claimed" : "AI predicted"} · locked before the run</span><strong>{label(story.prediction)}</strong><p>{story.prediction_reason}</p></div>
      <ArrowRight size={18} aria-hidden="true" />
      <div><span className="story-label"><Target size={12} /> Team concluded · fixed rules</span><strong>{item.recommendation ? label(item.recommendation) : "Investigating…"}</strong><p>{item.score !== null ? `Rule score ${item.score}/100.` : "Waiting for the scoring node."} The rules, not the AI, set this result.</p></div>
    </div>
    <div className="story-columns">
      <div>{challenge ? <><h4>Red-team tactic</h4><blockquote className="source-quote">{story.tactic ?? "No tactic given."}</blockquote></> : <><h4>Your story</h4><blockquote className="source-quote">{story.description}</blockquote></>}
        {story.injection_flags > 0 && <Alert severity="warning" sx={{ mt: 1 }}>Instruction-like text was found in the story and neutralised before reaching the model.</Alert>}</div>
      <div><h4>What code built</h4><ul className="story-recipe">{recipeSummary(story).map(line => <li key={line}>{line}</li>)}</ul>
        {story.adjustments.length > 0 && <><h4>Code corrections to the AI&apos;s recipe</h4><ul className="story-adjustments">{story.adjustments.map(a => <li key={a}>{a}</li>)}</ul></>}</div>
    </div>
    {story.attempts.length > 0 && <><h4>Red-team rounds · it learns from the rules that fired</h4>
      {!story.attempts.some(a => a.investigated && a.valid) && <Alert severity="info" sx={{ mb: 1 }}>No round moved the required $25,000, so none counts as a successful evasion. The team investigated the lowest-scoring attempt anyway.</Alert>}
      <ol className="story-rounds">{story.attempts.map(a => <li key={a.round} className={a.investigated ? "investigated" : ""}>
        <div className="round-top"><span className="round-number">{a.round}</span><strong>{a.title}</strong>{a.investigated && <Chip size="small" color="primary" label="Investigated by the team" />}{!a.valid && <Chip size="small" variant="outlined" label="Too small to count" />}</div>
        <p className="round-stats">Moved <strong>${a.moved.toLocaleString("en-US")}</strong> · rule score <strong>{a.score}</strong> → {label(a.recommendation as keyof typeof recommendations)}</p>
        <p className="round-tactic">{a.tactic}</p>
        <p className="round-rules">Rules that fired: {a.triggered.length ? a.triggered.join(" · ") : "none"}</p>
      </li>)}</ol></>}
    {story.blind_spots.length > 0 && <div className="story-blind"><h4>Rule blind spots in this story</h4><ul>{story.blind_spots.map(b => <li key={b}>{b}</li>)}</ul></div>}
    {story.note && <p className="helper">{story.note}</p>}
    <p className="helper">Synthetic training exercise. Agreement between the AI and the rules is not a measure of detection accuracy, and nothing here was filed or approved.</p>
  </section>;
}
