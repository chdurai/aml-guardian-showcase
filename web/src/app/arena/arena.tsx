"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { ArenaJob, Comparison, Trial, arenaJobSchema, comparisonSchema, fixtureSchema } from "@/lib/arena";
import "./arena.css";

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ detail: z.string() }).safeParse(payload);
    throw new Error(error.success ? error.data.detail : `Arena request failed (${response.status}).`);
  }
  return payload;
}

function TrialView({ title, trial }: { title: string; trial: Trial }) {
  return <section className="arena-card" aria-label={title}>
    <h2>{title}</h2>
    <p><strong>{trial.mode === "model" ? "Live model-selected" : `${trial.mode} execution`}</strong>
      {" / "}{trial.complete ? "Complete" : "Unresolved or partial"} / {trial.model}</p>
    <dl className="arena-metrics">
      <dt>Required coverage</dt><dd>{Math.round(trial.coverage * 100)}%</dd>
      <dt>Tool calls (initial + correction)</dt><dd>{trial.tool_calls} ({trial.initial_calls} + {trial.followup_calls})</dd>
      <dt>Model requests / retries</dt><dd>{trial.model_requests} / {trial.retries}</dd>
      <dt>Reported tokens (input / output)</dt><dd>{trial.prompt_tokens} / {trial.output_tokens}</dd>
      <dt>Invalid actions / unresolved</dt><dd>{trial.invalid_actions} / {trial.unresolved}</dd>
      <dt>Investigator time</dt><dd>{(trial.investigator_ms / 1000).toFixed(2)} s</dd>
      <dt>Correction time</dt><dd>{(trial.correction_ms / 1000).toFixed(2)} s</dd>
      <dt>Total trial time</dt><dd>{(trial.total_ms / 1000).toFixed(2)} s</dd>
    </dl>
    {trial.errors.map((error, i) => <p role="note" key={i}>{error}</p>)}
    <h3>Evidence and changes</h3>
    {!trial.challenges.length && <p>Clean: no hard-check challenges.</p>}
    {trial.challenges.map(challenge => {
      const original = trial.findings.find(f => f.id === challenge.finding_id && f.revision === challenge.finding_revision);
      const active = trial.findings.find(f => f.id === challenge.finding_id && f.status === "active");
      return <article className="arena-change" key={challenge.id} id={challenge.id}>
        <h4>{challenge.check}: {challenge.status}</h4>
        <p>Original claim: {original?.path} = {JSON.stringify(original?.value)} (revision {original?.revision})</p>
        <p>Critic requested only: <strong>{challenge.requested_tool}</strong></p>
        <p>Revised claim: {active?.path} = {JSON.stringify(active?.value)} (revision {active?.revision})</p>
        <p>Resolution: {challenge.status}</p>
        {challenge.resolution_evidence_ids.map(id => <a className="arena-id" key={id} href={`#${id}`}>{id}</a>)}
      </article>;
    })}
    <details><summary>Revision history and typed evidence</summary>
      {trial.findings.map(f => <p key={`${f.id}-${f.revision}`}>{f.id} r{f.revision}: {JSON.stringify(f.value)} / {f.status}
        {f.supersedes_revision && ` / supersedes r${f.supersedes_revision}`}</p>)}
      {trial.evidence.map(e => <p id={e.id} key={e.id} className="arena-id">
        {e.id}: {e.available ? e.text : "UNAVAILABLE - not a negative result"}</p>)}
    </details>
  </section>;
}

export default function Arena() {
  const [fixtures, setFixtures] = useState<z.infer<typeof fixtureSchema>[]>([]);
  const [fixture, setFixture] = useState("dev-02");
  const [mode, setMode] = useState<"compare" | "scripted">("compare");
  const [job, setJob] = useState<ArenaJob | null>(null);
  const [saved, setSaved] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [transport, setTransport] = useState("Not connected");
  const [busy, setBusy] = useState(false);
  const [actor, setActor] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    json("/api/arena/fixtures", { signal: controller.signal })
      .then(data => setFixtures(z.array(fixtureSchema).parse(data)))
      .catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, []);

  const identity = job?.id;
  const running = job?.status === "running";
  useEffect(() => {
    if (!identity || !running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/arena/runs/${identity}/events`);
    let polling = false;
    setTransport("Live public event stream");
    function fallback(reason: string) {
      if (polling || controller.signal.aborted) return;
      polling = true;
      source.close();
      setTransport(`${reason} Polling fallback active.`);
      async function poll() {
        try { setJob(arenaJobSchema.parse(await json(`/api/arena/runs/${identity}`, { signal: controller.signal }))); }
        catch (error) { if (!controller.signal.aborted) setError(String(error)); }
        if (!controller.signal.aborted) timer = setTimeout(poll, 700);
      }
      void poll();
    }
    source.addEventListener("arena", event => {
      try {
        const parsed = arenaJobSchema.parse(JSON.parse(event.data));
        if (parsed.id !== identity) throw new Error("Wrong arena stream identity.");
        setJob(previous => !previous || parsed.sequence >= previous.sequence ? parsed : previous);
      } catch { fallback("Malformed arena event."); }
    });
    source.onerror = () => fallback("Event stream unavailable.");
    return () => { source.close(); controller.abort(); if (timer) clearTimeout(timer); };
  }, [identity, running]);

  async function start() {
    setBusy(true); setError(""); setSaved(null);
    try {
      setJob(arenaJobSchema.parse(await json("/api/arena/runs", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixture_id: fixture, mode }) })));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  async function loadSaved() {
    setError("");
    try { setSaved(comparisonSchema.parse(await json("/arena-saved.json"))); setJob(null); setTransport("Saved report - no live execution."); }
    catch (error) { setError(`Saved report unavailable: ${String(error)}`); }
  }
  const report = saved ?? job?.report;
  const events = saved ? [...saved.baseline.events, ...(saved.agent?.events ?? [])] : job?.events ?? [];
  return <main className="arena-page">
    <nav><a href="/">Investigation workbench</a> <a href="/portfolio">Portfolio / guided demo</a></nav>
    <h1>Challenge Arena</h1>
    <p>Synthetic evidence experiments. Deliberately planted defects, not real customer accusations.
      Models never set scores, outcomes or approval.</p>
    <section className="arena-card">
      <label>Choose a challenge<select value={fixture} onChange={e => setFixture(e.target.value)}>
        {fixtures.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
      </select></label>
      <p>{fixtures.find(f => f.id === fixture)?.description}</p>
      <label>Execution mode<select value={mode} onChange={e => setMode(e.target.value === "scripted" ? "scripted" : "compare")}>
        <option value="compare">Compare baseline / agent-assisted</option><option value="scripted">Scripted baseline only</option>
      </select></label>
      <button onClick={start} disabled={!fixtures.length || busy || running}>{busy || running ? "Run in progress..." : "Run challenge"}</button>
      <button onClick={loadSaved} disabled={busy || running}>Load labelled saved report</button>
    </section>
    {error && <p role="alert">{error}</p>}
    <p role="status">{saved ? "SAVED REPORT - not a live AI run." : job ? `Job ${job.status}. ${transport}` : transport}</p>
    {job?.error && <p role="alert">{job.error}</p>}
    {report && <>
      <p>Fixture {report.fixture_id} / {report.fixture_version}; seed {report.seed}.</p>
      <p>Fixed policy reference: <strong>{report.policy_reference.recommendation}, score {report.policy_reference.score}</strong>.
        Shared code-owned reference, not an agent answer. No approval or filing.</p>
      <p>{report.comparison_eligible ? "Eligible equal-coverage live comparison." : "Not eligible for an AI efficiency claim."}</p>
      {report.exclusion_reasons.map(reason => <p key={reason}>{reason}</p>)}
      <div className="arena-pair"><TrialView title="Scripted baseline" trial={report.baseline} />
        {report.agent ? <TrialView title="Agent-assisted" trial={report.agent} /> : <p>No agent trial requested.</p>}</div>
      <details><summary>Runtime configuration and fixture hash</summary><pre>{JSON.stringify(report.configuration, null, 2)}</pre><p className="arena-id">{report.fixture_hash}</p></details>
    </>}
    {!!events.length && <section className="arena-card">
      <h2>Observable collaboration timeline</h2>
      <p>Selected actions and validation only. No invented reasoning transcript. Event durations are not additive to parent times.</p>
      <p>Objective IDs are code-mapped to observed tool choices, not a model reasoning transcript.</p>
      <label>Filter role<select value={actor} onChange={e => setActor(e.target.value)}>
        {["all", "investigator", "critic", "tool", "validator", "fallback"].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <ol>{events.filter(e => actor === "all" || e.actor === actor).map(e => <li key={`${e.run_id}/${e.sequence}`}>
        <strong>{e.actor}: {e.kind}</strong> / {e.duration_ms.toFixed(2)} ms
        <p className="arena-id">Run {e.run_id}; trace {e.trace_id}; sequence {e.sequence}</p>
        {Object.entries(e.details).map(([key, value]) => <span className="arena-id" key={key}>{key}: {String(value)}; </span>)}
        {typeof e.details.challenge_id === "string" && <a href={`#${e.details.challenge_id}`}>Inspect challenge</a>}
        {typeof e.details.evidence_id === "string" && e.details.evidence_id !== "unavailable" &&
          <a href={`#${e.details.evidence_id}`}>Inspect resolution evidence</a>}
      </li>)}</ol>
    </section>}
  </main>;
}
