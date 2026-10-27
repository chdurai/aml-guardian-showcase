"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Skeleton, Tooltip } from "@mui/material";
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleDot, Clock3, FileText, Fingerprint, FlaskConical, FolderOpen, GitBranch, Layers3, LayoutDashboard, Link2, ListFilter, LoaderCircle, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, Sparkles, WandSparkles, X } from "lucide-react";
import { z } from "zod";
import { Case, caseSchema, recommendations, runtimeSchema, scenarios, Scenario, statusLabels } from "@/lib/contracts";
import GroundingPanel, { modelLabel, runtimeNote } from "./grounding-panel";
import { executionSteps, flowTotals, outcomeExplanation, scoreContributions } from "@/lib/investigation";
import AgentShowcase from "./agent-showcase";
import ScenarioComparison from "./scenario-comparison";
import { StoryCard, StoryStudioDialog } from "./story-studio";
import PolicyAssistant from "./policy-assistant";
import InvestigatorPanel from "./investigator-panel";
import { subscribeToCase } from "@/lib/case-events";
import ReviewPanel, { ActionNeededBanner } from "./review-panel";

type Tab = "overview" | "evidence" | "draft" | "activity";
const tabs: { id: Tab; title: string; icon: typeof Activity }[] = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "evidence", title: "Evidence", icon: Layers3 },
  { id: "draft", title: "Case draft", icon: FileText },
  { id: "activity", title: "Activity", icon: Activity },
];
const nodes: Record<string, string> = {
  alert_intake: "Alert intake", entity_resolution: "Entity research", graph_analysis: "Transaction analysis",
  typology_rag: "Guidance retrieval", sanctions_screening: "Illustrative screening",
  risk_scoring: "Rule-based assessment", evidence_critic: "Evidence-link check",
  sar_drafter: "Draft preparation", hitl_approval: "Human checkpoint", case_close: "Workflow closure",
  investigator: "Evidence investigation",
};
const money = (amount: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function request(path = "", scenario?: Scenario): Promise<unknown> {
  const response = await fetch(`/api/cases${path}`, {
    method: scenario ? "POST" : "GET", cache: "no-store",
    headers: scenario ? { "Content-Type": "application/json" } : undefined,
    body: scenario ? JSON.stringify({ scenario }) : undefined,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ detail: z.string() }).safeParse(body);
    throw new Error(parsed.success ? parsed.data.detail : "The request could not be completed.");
  }
  return body;
}

function Status({ item }: { item: Case }) {
  return <span className={`status ${item.status}`}><span className="status-dot" />{statusLabels[item.status]}</span>;
}

export default function Workbench() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const id = params.get("case");
  const requestedTab = params.get("tab");
  const tab: Tab = tabs.some(t => t.id === requestedTab) ? requestedTab as Tab : "overview";
  const [newCase, setNewCase] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("structuring");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Tab | null>(null);
  const [about, setAbout] = useState(false);
  const runtime = useQuery({ queryKey: ["runtime"], queryFn: async () => runtimeSchema.parse(await (await fetch("/api/runtime", { cache: "no-store" })).json()), staleTime: 60_000, retry: false });
  const [compare, setCompare] = useState(false);
  const [studio, setStudio] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [streamError, setStreamError] = useState<{ id: string; message: string } | null>(null);
  const cases = useQuery({
    queryKey: ["cases"], queryFn: async () => z.array(caseSchema).parse(await request()),
    refetchInterval: query => query.state.data?.some(c => c.status === "running") ? 1200 : 5000,
  });
  const detail = useQuery({
    queryKey: ["case", id], enabled: Boolean(id),
    queryFn: async () => caseSchema.parse(await request(`/${encodeURIComponent(id!)}`)),
    refetchInterval: query => query.state.data?.status === "running" ? 1000 : 5000,
  });
  const create = useMutation({
    mutationFn: async () => caseSchema.parse(await request("", scenario)),
    onSuccess: item => {
      client.setQueryData(["case", item.id], item);
      void client.invalidateQueries({ queryKey: ["cases"] });
      setNewCase(false);
      setSearch("");
      setFilter("all");
      router.push(`/?case=${item.id}&tab=overview`);
    },
  });
  const story = useMutation({
    mutationFn: async ({ mode, description }: { mode: "design" | "challenge"; description: string }) => {
      const response = await fetch("/api/stories", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, description }) });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ detail: z.string() }).safeParse(body);
        throw new Error(parsed.success ? parsed.data.detail : "The story could not be created.");
      }
      return caseSchema.parse(body);
    },
    onSuccess: created => {
      client.setQueryData(["case", created.id], created);
      void client.invalidateQueries({ queryKey: ["cases"] });
      setStudio(false);
      setSearch("");
      setFilter("all");
      router.push(`/?case=${created.id}&tab=overview`);
    },
  });
  const openStudio = () => { story.reset(); setStudio(true); };
  useEffect(() => { setSourceId(null); }, [id]);
  useEffect(() => {
    if (reviewTarget !== tab) return;
    const content = document.getElementById("case-content");
    content?.focus({ preventScroll: true });
    content?.scrollIntoView({ block: "start" });
    setReviewTarget(null);
  }, [reviewTarget, tab]);
  useEffect(() => {
    if (detail.data?.status !== "running") return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [detail.data?.status]);
  const item = detail.data;
  const selectedStatus = item?.status;
  useEffect(() => {
    if (!id || selectedStatus !== "running") return;
    setStreamError(null);
    return subscribeToCase(id, snapshot => {
      client.setQueryData(["case", id], snapshot);
      client.setQueryData<Case[]>(["cases"], current => current?.map(c => c.id === id ? snapshot : c));
    }, message => setStreamError({ id, message }));
  }, [client, id, selectedStatus]);
  const list = (cases.data ?? []).filter(c =>
    `${c.account} ${c.originator} ${c.beneficiary} ${c.story?.title ?? ""}`.toLowerCase().includes(search.toLowerCase()) &&
    (filter === "all" || c.status === filter));
  const changeTab = (next: Tab) => {
    setSourceId(null);
    router.push(`/?case=${id}&tab=${next}`, { scroll: false });
  };
  const refresh = () => { void cases.refetch(); if (id) void detail.refetch(); };
  const source = item?.sources.find(s => s.id === sourceId);
  const recentEvents = item?.events.slice(-6) ?? [];
  const elapsed = item ? Math.max(0, Math.floor(((item.status === "running" ? tick : new Date(item.updated_at).getTime()) - new Date(item.created_at).getTime()) / 1000)) : 0;
  const totals = item ? flowTotals(item) : null;
  const waiting = (cases.data ?? []).filter(c => c.status === "awaiting_human").length;
  const goToDecision = () => {
    const panel = document.getElementById("decision");
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className="app">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar" aria-label="Application navigation">
      <a href="/" className="brand"><span className="brand-mark"><ShieldCheck size={24} /></span><span>guardian<span className="brand-sub">INVESTIGATION WORKSPACE</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <a className="nav-item active" href="/"><FolderOpen size={19} />Investigations <span className="nav-count">{cases.data?.length ?? "—"}</span></a>
      <a className="nav-item" href="/arena"><FlaskConical size={19} />Challenge Arena</a>
      <a className="nav-item" href="/usage-guide.html" target="_blank" rel="noopener noreferrer"><BookOpen size={19} />Beginner&apos;s guide <ArrowUpRight size={13} /></a>
      <div className="sidebar-divider" />
      <div className="workspace-label">BUILT FOR CLARITY</div>
      <div className="principle"><span><Fingerprint size={17} /></span><div>Evidence before conclusions<p>Inspect the source behind every finding.</p></div></div>
      <div className="principle"><span><GitBranch size={17} /></span><div>Visible orchestration<p>Follow each step, not a black box.</p></div></div>
      <div className="sidebar-bottom"><div className="local-pill"><span /> LOCAL WORKSPACE</div><p>Synthetic data only.<br />No customer information.</p><span className="version">AML Guardian · v0.1</span></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14} /><strong>Investigations</strong>{item && <><ChevronRight size={14} /><span>{item.account}</span></>}</div><div className="topbar-right"><span className="synthetic-label"><FlaskConical size={14} />Synthetic environment</span><Tooltip title="Local workspace; user authentication is not configured"><span className="avatar" role="img" aria-label="Local workspace, not a signed-in user"><LockKeyhole size={16} /></span></Tooltip></div></header>
      <main id="workspace">
        <div className="page-heading"><div><div className="eyebrow">SEE THE SIGNAL. UNDERSTAND THE STORY.</div><h1>Investigation workspace<span className="title-dot">.</span></h1><p>From transaction patterns to a traceable, evidence-led assessment.</p></div><div className="heading-actions"><a className="guide-link" href="/usage-guide.html" target="_blank" rel="noopener noreferrer"><BookOpen size={15} />Start here: usage guide</a><PolicyAssistant key={`${item?.id ?? "general"}-${item?.status ?? ""}`} item={item && !["running", "failed"].includes(item.status) ? item : undefined} /><Button variant="contained" startIcon={<Plus size={17} />} onClick={() => { create.reset(); setNewCase(true); }}>New investigation</Button></div></div>
        <div className="environment-note"><FlaskConical size={16} /><span><strong>Connected synthetic workspace.</strong> Runs the existing LangGraph workflow. Deterministic analysis · {runtimeNote(runtime.data)} · session-only storage.</span><button onClick={() => setAbout(true)}>How it works <ArrowUpRight size={13} /></button></div>
        <div className="showcase-banner"><div><strong>Same specialist team. Four different decision paths.</strong><p>Compare routine closure, a review recommendation, report consideration and a screening hold.</p></div><Button variant="outlined" startIcon={<GitBranch size={16} />} onClick={() => setCompare(true)}>Compare scenarios</Button></div>
        <div className="showcase-banner studio-banner"><div><strong>New: invent your own story—or let an AI red team try to beat the rules.</strong><p>The local model designs it, code builds and checks it, and the same agent team investigates. You see whether the AI&apos;s prediction held.</p></div><Button variant="contained" startIcon={<WandSparkles size={16} />} onClick={openStudio}>Open story studio</Button></div>
        {(cases.isError || detail.isError) && <Alert severity="error" action={<Button color="inherit" size="small" onClick={refresh}>Retry</Button>}>{(detail.error ?? cases.error)?.message}{item && " · Last snapshot may be out of date."}</Alert>}
        <div className="workspace-grid">
          <section className="case-queue panel" aria-labelledby="queue-title">
            <div className="queue-heading"><div><h2 id="queue-title">Case queue <span>{cases.data?.length ?? "—"}</span></h2><p>Your local investigations</p>{waiting > 0 && <button className="action-count" onClick={() => setFilter("awaiting_human")}>{waiting} need{waiting === 1 ? "s" : ""} your decision</button>}</div><Tooltip title="Refresh cases"><button className="icon-button" aria-label="Refresh cases" onClick={refresh}><RefreshCw size={16} /></button></Tooltip></div>
            <label className="search-box"><Search size={16} /><input aria-label="Search cases" placeholder="Find an account or party" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label className="filter-box"><ListFilter size={15} /><select aria-label="Filter case lifecycle" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All investigations</option><option value="awaiting_human">Needs your decision</option><option value="running">Investigating</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
            <div className="case-list">{cases.isPending ? <div className="queue-skeleton"><Skeleton height={70} /><Skeleton height={70} /><Skeleton height={70} /></div> : list.length ? list.map(c => <a key={c.id} href={`/?case=${c.id}&tab=overview`} onClick={e => { e.preventDefault(); router.push(`/?case=${c.id}&tab=overview`); }} className={`case-row ${c.id === id ? "selected" : ""}`} aria-current={c.id === id ? "page" : undefined}><div className="case-row-top"><span className="account-icon"><FolderOpen size={16} /></span><strong>{c.account}</strong><ChevronRight size={14} /></div><div className="case-party">{c.story ? `${c.story.mode === "challenge" ? "Red team" : "Story"} · ${c.story.title}` : c.beneficiary}</div><Status item={c} />{c.status === "awaiting_human" && <span className="action-chip">Action needed · {c.review?.role.split(" · ")[0] ?? "Review"}</span>}<div className="case-foot"><span>{c.recommendation ? recommendations[c.recommendation] : "Assessment in progress"}</span><time>{time(c.created_at)}</time></div></a>) : <div className="queue-empty"><FolderOpen size={24} /><strong>{cases.isError ? "Queue unavailable" : cases.data?.length ? "No matching cases" : "A clear starting point"}</strong><p>{cases.isError ? "Retry the API connection above." : cases.data?.length ? "Adjust your search or filter." : "Start a synthetic investigation to see the workflow in action."}</p></div>}</div>
            <div className="queue-footer"><LockKeyhole size={12} />Local session · resets on API restart</div>
          </section>

          <section className="case-workspace" aria-label="Selected investigation">
            {!id ? <div className="welcome panel"><div className="welcome-orbit"><ShieldCheck size={43} /><span className="orbit-dot one" /><span className="orbit-dot two" /></div><span className="eyebrow">PURPOSE-BUILT INVESTIGATION</span><h2>Every finding has a story.<br />Start with the evidence.</h2><p>Explore transaction patterns, inspect retrieved guidance and follow specialist contributions in one connected workspace.</p><div className="welcome-actions"><Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={() => { create.reset(); setNewCase(true); }}>Start an investigation</Button><Button variant="outlined" startIcon={<WandSparkles size={16} />} onClick={openStudio}>Invent your own story</Button></div><div className="welcome-features"><span><Layers3 size={16} />Connected evidence</span><span><GitBranch size={16} />Visible workflow</span><span><Fingerprint size={16} />Traceable findings</span></div></div> : !item ? <div className="panel loading-case">{detail.isError ? <><h2>Case unavailable</h2><p>It may belong to an earlier local session. Choose a case from the queue or start a new investigation.</p></> : <><Skeleton width="60%" height={45} /><Skeleton height={180} /><p role="status">Loading investigation…</p></>}</div> : <>
              <div className="case-header panel">
                <div className="case-header-top"><span className="case-kicker"><FolderOpen size={14} />INVESTIGATION / {item.story ? (item.story.mode === "challenge" ? "RED-TEAM CHALLENGE" : "STORY STUDIO") : item.scenario.toUpperCase()}</span><Status item={item} /></div>
                <div className="case-identity"><div><h2>{item.account}</h2><p>{item.originator} <ArrowRight size={13} /> {item.beneficiary}</p></div><span className={`recommendation ${item.recommendation === "HOLD" ? "hold" : ""}`}>{item.recommendation ? recommendations[item.recommendation] : "Assessment in progress"}</span></div>
                <div className="case-meta"><span><Clock3 size={13} />{item.window}</span><span><FlaskConical size={13} />{item.story ? "AI-designed synthetic story" : "Synthetic fixture"}</span><span><CircleDot size={13} />{executionSteps(item).filter(step => step.end).length} completed steps</span></div>
                {item.status === "running" && <div className="run-progress"><LinearProgress /><span role="status">Investigating · {elapsed}s elapsed · no estimated completion</span></div>}
                {item.error && <Alert severity="error">{item.error}</Alert>}
                {streamError?.id === id && <Alert severity="warning" role="alert">{streamError.message}</Alert>}
                <nav className="case-tabs" aria-label="Case sections">{tabs.map(t => <button key={t.id} aria-current={tab === t.id ? "page" : undefined} className={tab === t.id ? "selected" : ""} onClick={() => changeTab(t.id)}><t.icon size={16} />{t.title}{t.id === "evidence" && <span>{item.findings.length}</span>}</button>)}</nav>
              </div>
              <ActionNeededBanner item={item} onGo={goToDecision} />
              <section className="journey-panel panel" aria-label="Guided investigation steps">
                <div className="journey-intro"><strong>Your investigation, step by step</strong><span>Follow this order; you can revisit any step.</span></div>
                <ol className="journey-steps">{tabs.map((step, index) => <li key={step.id}><button aria-current={tab === step.id ? "step" : undefined} onClick={() => changeTab(step.id)}><span>{index + 1}</span><div><strong>{["Understand", "Check sources", "Read the draft", "See what ran"][index]}</strong><small>{["What happened?", "What supports it?", "What is still missing?", "Where did it stop?"][index]}</small></div></button></li>)}</ol>
              </section>
              <section className="outcome-panel" aria-label="Result explained" aria-live="polite"><CircleDot size={19} /><div><strong>{item.status === "running" ? "What is happening now?" : "What does this result mean?"}</strong><p>{outcomeExplanation(item)}</p>{item.status === "awaiting_human" && <p><strong>Next step is yours:</strong> review the evidence, then record a decision in the <button className="inline-link" onClick={goToDecision}>decision panel</button>. Code checks which actions are allowed.</p>}{item.disposition && item.status === "completed" && <p><strong>Final outcome:</strong> {item.disposition}</p>}</div></section>
              <ReviewPanel key={`${item.id}-${item.review?.level ?? 0}`} item={item} openTab={next => { setReviewTarget(next); changeTab(next); }} />
              <div id="case-content" tabIndex={-1} className={`detail-layout ${tab === "activity" ? "full" : ""}`}>
                <div className="detail-main">
                  {tab === "overview" && <>
                    <StoryCard item={item} />
                    {item.investigator && <InvestigatorPanel report={item.investigator} />}
                    <div className="summary-grid"><div className="metric-card"><span>Rule-based risk score</span><strong>{item.score ?? "—"}<small>/100</small></strong><div className="score-track"><span style={{ width: `${item.score ?? 0}%` }} /></div><p>Deterministic score, not AI confidence</p></div><div className="metric-card"><span>Transaction footprint</span><strong>{item.transactions.length}<small> transfers</small></strong><p>{item.metrics.nodes} entities · {item.metrics.cycles} cycles</p><span className="metric-tag"><GitBranch size={12} />Graph-derived indicators</span></div></div>
                    <div className="panel section-panel"><div className="section-heading"><span className="section-icon"><ArrowDownLeft size={19} /></span><div><h3>Follow the money</h3><p>Observed transfers involving {item.account}</p></div></div><div className="money-flow"><div><span>Incoming</span><strong>{money(totals?.incoming ?? 0, item.currency)}</strong></div><span className="flow-connector"><ArrowRight size={21} /></span><div className="flow-account"><FolderOpen size={17} /><strong>{item.account}</strong></div><span className="flow-connector"><ArrowRight size={21} /></span><div><span>Outgoing</span><strong>{money(totals?.outgoing ?? 0, item.currency)}</strong></div></div><p className="helper">Net observed flow: {money(totals?.net ?? 0, item.currency)}. This is incoming minus outgoing, not the account balance. Alert metadata is separate from transaction totals.</p></div>
                    <ScoreExplanation item={item} />
                    <div className="panel section-panel"><div className="section-heading"><span className="section-icon amber"><Search size={18} /></span><div><h3>Signals worth a closer look</h3><p>Deterministic findings, with their evidence references</p></div></div>{item.findings.filter(f => ["graph_analysis", "risk_scoring", "sanctions_screening"].includes(f.agent)).map((f, i) => <div className="signal" key={i}><span className="signal-dot" /><div><strong>{nodes[f.agent]}</strong><p>{f.claim}</p>{f.agent === "sanctions_screening" && <span className="method-note">Illustrative two-name substring check only; not live sanctions or PEP coverage.</span>}</div></div>)}{item.status === "running" && <p className="helper">Findings will appear after the workflow reaches its next outcome.</p>}<button className="text-action" onClick={() => changeTab("evidence")}>Explore all findings <ArrowRight size={14} /></button></div>
                    <div className="unknown-note"><CircleDot size={18} /><div><strong>Keep the unknowns visible</strong><p>Customer purpose, independent identity verification and claim-level factual support are not established by this workflow.</p></div></div>
                  </>}
                  {tab === "evidence" && <div className="panel section-panel"><div className="section-heading"><span className="section-icon"><Layers3 size={19} /></span><div><h3>Evidence ledger</h3><p>Facts and retrieved guidance, without a blanket “verified” label</p></div></div><h4>Specialist findings <span className="muted">/ {item.findings.length}</span></h4><div className="findings">{item.findings.map((f, i) => <article className="finding" key={`${f.agent}-${i}`}><div className="finding-heading"><span className="finding-number">{String(i + 1).padStart(2, "0")}</span><strong>{nodes[f.agent] ?? f.agent}</strong><span className="support-label">Support not assessed</span></div><p>{f.claim}</p><div className="citation-list">{f.evidence_ids.map(e => <button key={e} onClick={() => setSourceId(e)}><Link2 size={12} />{e === item.graph_case_id ? "Alert / transactions" : e === "sanctions" ? "Screening method" : e}</button>)}</div></article>)}</div><h4>Observed transactions <span className="muted">/ USD</span></h4><div className="table-scroll" role="region" aria-label="Observed transactions" tabIndex={0}><table><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Date · 2026</th></tr></thead><tbody>{item.transactions.map((t, i) => <tr key={i}><td>{t.source}</td><td>{t.target}</td><td className="amount">{money(t.amount)}</td><td>{t.timestamp}</td></tr>)}</tbody></table></div>{!item.transactions.length && <p className="helper">No transactions in this fixture.</p>}<h4>Retrieved guidance <span className="muted">/ illustrative corpus</span></h4><div className="source-cards">{item.sources.map(s => <button key={s.id} onClick={() => setSourceId(s.id)}><BookOpen size={19} /><strong>{s.id}</strong><span>{s.source}</span><ArrowUpRight size={15} /></button>)}</div><p className="helper">Retrieved passages are not currently fed into the stub writer. Retrieval does not establish claim support.</p></div>}
                  {tab === "draft" && <div className="panel section-panel"><div className="section-heading"><span className="section-icon"><FileText size={19} /></span><div><h3>Case narrative</h3><p>Read-only output from the existing workflow</p></div><Chip size="small" label={item.recommendation === "CLEAR" ? "Fixed rule output" : item.grounding ? (item.grounding.mode === "model" ? `Local model · ${modelLabel(item.grounding.model)}` : "Verified fact template") : "Stub narration"} variant="outlined" /></div><div className="draft-notice"><Sparkles size={17} /><p>{item.recommendation === "CLEAR" ? "The current CLEAR route returns fixed text and closes automatically. No human decision was recorded." : item.grounding ? "Draft for investigator review only. The model wrote the wording; scores, recommendation and routing were already fixed by code and cannot be changed by the model. This is not a filed or filing-ready SAR." : "This is deterministic placeholder narration, not a live-model SAR or a supported filing document."}</p></div>{item.grounding && <GroundingPanel grounding={item.grounding} />}<pre className="narrative">{item.narrative || "Narrative preparation has not completed."}</pre><div className="decision-notice"><LockKeyhole size={19} /><div><strong>{item.status === "awaiting_human" ? "Your decision is recorded in the decision panel, not here" : item.reviews.length ? "A human decision was recorded" : "No human decision on this route"}</strong><p>{item.status === "awaiting_human" ? "Read this draft, then approve SAR filing, close the case or escalate it in the decision panel at the top of the case. The draft text itself is not editable." : item.disposition ?? "The workflow did not reach the human checkpoint."}</p>{item.status === "awaiting_human" && <button className="text-action" onClick={goToDecision}>Go to decision <ArrowRight size={14} /></button>}</div></div></div>}
                  {tab === "activity" && <><AgentShowcase key={item.id} item={item} inspect={setSourceId} /><div className="panel section-panel"><div className="section-heading"><span className="section-icon"><Activity size={19} /></span><div><h3>Execution timeline</h3><p>Actual node activity · public metadata only</p></div><Chip size="small" label={`${elapsed}s elapsed`} variant="outlined" /></div><Timeline events={item.events} /><p className="helper">The human-checkpoint start event is not an approval. Activity uses live snapshots with polling fallback from this API session, not a durable audit log.</p></div></>}
                  <div className="journey-navigation"><Button variant="outlined" disabled={tab === "overview"} onClick={() => changeTab(tabs[tabs.findIndex(t => t.id === tab) - 1].id)}>Previous step</Button>{tab !== "activity" ? <Button variant="contained" endIcon={<ArrowRight size={15} />} onClick={() => changeTab(tabs[tabs.findIndex(t => t.id === tab) + 1].id)}>Continue to {tabs[tabs.findIndex(t => t.id === tab) + 1].title}</Button> : <a className="guide-link" href="/usage-guide.html#practice" target="_blank" rel="noopener noreferrer">Finished exploring? Try the other scenarios <ArrowUpRight size={14} /></a>}</div>
                </div>
                {tab !== "activity" && <aside className="context-rail" aria-label="Investigation context"><div className="panel rail-panel"><div className="rail-heading"><span className="tiny-icon"><GitBranch size={16} /></span><h3>Workflow pulse</h3><span className={`pulse-light ${item.status === "running" ? "live" : ""}`} /></div><p className="rail-subtitle">LangGraph · code-owned routing</p><Timeline events={recentEvents} compact /><button className="text-action" onClick={() => changeTab("activity")}>Full activity <ArrowRight size={14} /></button><div className="connection"><span className={detail.isError ? "offline" : "online"} />{detail.isError ? "Connection lost · stale snapshot" : "Connected · polling"}{detail.isFetching && <RefreshCw size={11} />}</div></div><div className="rail-guidance"><BookOpen size={20} /><h3>Trace the source.<br />Question the conclusion.</h3><p>A linked source is a starting point—not proof that a claim is supported.</p><button className="text-action" onClick={() => changeTab("evidence")}>Inspect evidence <ArrowRight size={14} /></button></div></aside>}
              </div>
              <div className="case-bottom"><Fingerprint size={13} /><span>Case reference: {item.graph_case_id ?? item.id} · No external action or filing performed</span></div>
            </>}
          </section>
        </div>
        <footer className="app-footer"><span><ShieldCheck size={13} />Designed for clarity. Governed by evidence.</span><span>Local synthetic release · authentication and durable storage not configured</span></footer>
      </main>
    </div>

    <Dialog open={newCase} onClose={() => { if (!create.isPending) setNewCase(false); }} fullWidth maxWidth="sm">
      <DialogTitle><span className="dialog-kicker">A SAFE PLACE TO EXPLORE</span>Start a synthetic investigation</DialogTitle>
      <DialogContent><p className="dialog-description">Choose a built-in fixture. The Python workflow runs real analysis on synthetic inputs—no uploads, credentials or customer data.</p><fieldset className="scenario-options"><legend className="sr-only">Investigation scenario</legend>{scenarios.map(s => <label key={s.id} className={`scenario-option ${s.id === scenario ? "selected" : ""}`}><input type="radio" name="scenario" checked={scenario === s.id} onChange={() => setScenario(s.id)} disabled={create.isPending} /><span><strong>{s.title}</strong><small>{s.detail}</small></span>{s.id === scenario && <Check size={18} />}</label>)}</fieldset>{create.isError && <Alert severity="error">{create.error.message} No automatic resubmission was performed. Refresh the queue before retrying if the response was lost.</Alert>}<p className="helper"><LockKeyhole size={12} /> No live model calls. Cases exist only until the API restarts.</p></DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}><Button disabled={create.isPending} onClick={() => setNewCase(false)}>Cancel</Button><Button variant="contained" disabled={create.isPending} startIcon={create.isPending ? <LoaderCircle size={16} /> : <ArrowRight size={16} />} onClick={() => create.mutate()}>{create.isPending ? "Starting…" : "Run investigation"}</Button></DialogActions>
    </Dialog>

    <StoryStudioDialog open={studio} onClose={() => setStudio(false)} runtime={runtime.data} pending={story.isPending} error={story.isError ? story.error.message : null} submit={(mode, description) => story.mutate({ mode, description })} />
    <Dialog open={compare} onClose={() => setCompare(false)} fullWidth maxWidth="md"><DialogTitle>One workflow, different routes</DialogTitle><DialogContent>{cases.isError ? <Alert severity="error">Cannot load current runs. Close this comparison and refresh the queue.</Alert> : cases.isPending ? <p role="status">Loading recorded runs…</p> : <ScenarioComparison cases={cases.data} openCase={selected => { setCompare(false); setSearch(""); setFilter("all"); router.push(`/?case=${selected.id}&tab=activity`); }} runScenario={selected => { setCompare(false); setScenario(selected); create.reset(); setNewCase(true); }} />}</DialogContent><DialogActions><Button onClick={() => setCompare(false)}>Close comparison</Button></DialogActions></Dialog>
    <Dialog open={Boolean(sourceId)} onClose={() => setSourceId(null)} fullWidth maxWidth="sm"><DialogTitle>Source inspection</DialogTitle><DialogContent>{source ? <><Chip size="small" label={source.id} variant="outlined" /><h3>{source.source}</h3><blockquote className="source-quote">{source.text}</blockquote><Alert severity="info">Illustrative in-code guidance, not a live regulatory feed. Claim-level support has not been assessed.</Alert></> : sourceId === "sanctions" ? <><h3>Illustrative screening method</h3><p>The existing tool checks normalized party names against a two-name substring list. It is not a sanctions/PEP service and provides no complete coverage or match assurance.</p></> : sourceId === item?.graph_case_id ? <><h3>Alert and transaction input</h3><p>This finding references the synthetic alert as a whole, not an independently verified external source.</p><Button onClick={() => { setSourceId(null); changeTab("evidence"); }}>View transaction ledger</Button></> : <Alert severity="warning">This reference does not resolve to an available source. Do not treat it as supported.</Alert>}</DialogContent><DialogActions><Button onClick={() => setSourceId(null)} startIcon={<X size={15} />}>Close inspection</Button></DialogActions></Dialog>
    <Dialog open={about} onClose={() => setAbout(false)} fullWidth maxWidth="sm"><DialogTitle>One workspace. Clear boundaries.</DialogTitle><DialogContent><p>Start with one of four synthetic cases. The Next.js interface calls FastAPI, which runs the existing LangGraph investigation and projects its findings, sources and node events back into this workspace.</p><ul className="about-list"><li><strong>Analysis:</strong> deterministic Python/NetworkX rules.</li><li><strong>Narration:</strong> a stub, not a live language model.</li><li><strong>Guidance:</strong> a small illustrative retrieval corpus.</li><li><strong>Human checkpoint:</strong> visible, but action-specific commands are intentionally not exposed.</li><li><strong>Persistence:</strong> in-process only; restart clears the session.</li><li><strong>Access:</strong> local use only, without user authentication. Do not expose publicly or submit customer data.</li></ul><p>Recommendations are not filing decisions. “Hold” is not a payment-blocking instruction. The CLEAR route currently closes automatically; this interface does not change the graph&apos;s policy.</p></DialogContent><DialogActions><Button onClick={() => setAbout(false)}>Understood</Button></DialogActions></Dialog>
  </div>;
}

function Timeline({ events, compact = false }: { events: Case["events"]; compact?: boolean }) {
  const entries = compact ? events : [...events].reverse();
  return <ol className={`timeline ${compact ? "compact" : ""}`}>{entries.length ? entries.map(e => <li key={e.sequence}><span className={`timeline-mark ${e.phase}`} aria-hidden="true">{e.phase === "completed" ? <CheckCheck size={13} /> : <CircleDot size={12} />}</span><div><strong>{nodes[e.node] ?? e.node}</strong><span>{e.phase === "completed" ? "Step completed" : e.node === "hitl_approval" ? "Human checkpoint entered" : "Step started"}</span></div><time dateTime={e.timestamp}>{time(e.timestamp)}</time></li>) : <li className="helper">Waiting for the first node event…</li>}</ol>;
}

function ScoreExplanation({ item }: { item: Case }) {
  let explanation: React.ReactNode;
  if (item.status === "failed") {
    explanation = <p>Score explanation is unavailable because the investigation failed. Do not interpret incomplete metrics as a successful assessment.</p>;
  } else if (item.status === "running") {
    explanation = <p>Wait for the analysis to finish before interpreting its score.</p>;
  } else if (item.recommendation === "HOLD") {
    explanation = <p>The illustrative screening match forces a score of 100. It overrides the transaction score, even when this fixture has no transfers. It is not a 100% probability of wrongdoing.</p>;
  } else {
    explanation = <><dl>{scoreContributions(item).map(c => <div key={c.label}><dt>{c.label}</dt><dd>+{c.points}</dd></div>)}</dl><p>Rule points are added, then capped at 100. Below 40: no escalation recommended; 40–69: review recommended; 70 or higher: report consideration. These are illustrative application rules, not legal reporting decisions. Multiple amounts below $10,000 alone do not establish intent to evade reporting.</p></>;
  }
  return <details className="score-explanation panel"><summary>Why this score? See the rule breakdown</summary>{explanation}</details>;
}
