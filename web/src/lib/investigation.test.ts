import { describe, expect, it } from "vitest";
import type { Case } from "./contracts";
import { executionSteps, flowTotals, outcomeExplanation, recipeSummary, scoreContributions, storyVerdict } from "./investigation";

const item: Case = {
  id: "test", scenario: "structuring", account: "ACC-4471", originator: "J. DOE",
  beneficiary: "SHELLCO TRADING", window: "", currency: "USD", created_at: "", updated_at: "",
  status: "awaiting_human", graph_case_id: "graph", recommendation: "FILE_SAR", score: 100, reviews: [],
  transactions: [
    { source: "ATM-1", target: "ACC-4471", amount: 9500, timestamp: "10-01" },
    { source: "ATM-2", target: "ACC-4471", amount: 9700, timestamp: "10-03" },
    { source: "ATM-3", target: "ACC-4471", amount: 9200, timestamp: "10-05" },
    { source: "ACC-4471", target: "SHELLCO", amount: 28000, timestamp: "10-07" },
    { source: "SHELLCO", target: "ACC-4471", amount: 9900, timestamp: "10-09" },
  ],
  metrics: { nodes: 5, fan_in: 4, cycles: 1, structuring_hits: 4 },
  findings: [], sources: [], narrative: "", events: [], error: null,
};
describe("specialist graph steps with live investigator tool progress", () => {
  const event = (sequence: number, node: string, phase: "started" | "completed", duration_ms: number | null = null): Case["events"][number] =>
    ({ sequence, node, phase, timestamp: "", summary: [`${node} ${sequence}`], evidence_ids: [], duration_ms });
  const partial: NonNullable<Case["investigator"]> = {
    mode: "partial", model: "stub", steps: [], selected_ids: [], summary: [], errors: [],
    latency_ms: 0, model_calls: 0, invalid_calls: 0,
  };
  const progress = [
    event(1, "alert_intake", "started"), event(2, "alert_intake", "completed", 1),
    event(3, "investigator", "started"),
    event(4, "investigator", "started"), event(5, "investigator", "completed", 2),
    event(6, "investigator", "started"), event(7, "investigator", "completed", 3),
  ];
  it("shows one in-progress investigator while partial tool results arrive", () => {
    const steps = executionSteps({ events: progress, status: "running", investigator: partial });
    expect(steps.map(step => step.start.node)).toEqual(["alert_intake", "investigator"]);
    expect(steps[1].start.sequence).toBe(3);
    expect(steps[1].end).toBeUndefined();
    expect(steps[0].end?.sequence).toBe(2);
  });
  it("uses the final completion instead of duplicating each tool call or counting its duration twice", () => {
    const events = [...progress, event(8, "investigator", "completed", 10), event(9, "risk_scoring", "started")];
    const steps = executionSteps({ events, status: "running", investigator: { ...partial, mode: "scripted" } });
    expect(steps.map(step => step.start.node)).toEqual(["alert_intake", "investigator", "risk_scoring"]);
    expect(steps[1].end?.sequence).toBe(8);
    expect(steps.reduce((sum, step) => sum + (step.end?.duration_ms ?? 0), 0)).toBe(11);
  });
  it("can finish with partial evidence when the graph advances or stops", () => {
    const events = [...progress, event(8, "risk_scoring", "started")];
    expect(executionSteps({ events, status: "running", investigator: partial })[1].end?.sequence).toBe(7);
    expect(executionSteps({ events: progress, status: "failed", investigator: partial })[1].end?.sequence).toBe(7);
  });
  it("preserves the disabled investigator route and genuine repeated non-investigator steps", () => {
    const events = [
      event(1, "alert_intake", "started"), event(2, "alert_intake", "completed"),
      event(3, "alert_intake", "started"), event(4, "alert_intake", "completed"),
    ];
    expect(executionSteps({ events, status: "completed" }).map(step => step.start.sequence)).toEqual([1, 3]);
  });
});
describe("plain-English investigation explanations", () => {
  it("uses actual fixture totals, not the alert metadata amount or a balance", () => {
    expect(flowTotals(item)).toEqual({ incoming: 38300, outgoing: 28000, net: 10300 });
  });
  it("matches the five rule contributions and final cap", () => {
    const contributions = scoreContributions(item);
    expect(contributions.map(c => c.points)).toEqual([50, 20, 25, 30, 10]);
    expect(Math.min(100, contributions.reduce((sum, c) => sum + c.points, 0))).toBe(item.score);
  });
  it("separates screening override and automatic closure from approval", () => {
    expect(outcomeExplanation({ ...item, recommendation: "HOLD" })).toContain("not a confirmed real-world");
    expect(outcomeExplanation({ ...item, recommendation: "CLEAR", status: "completed" })).toContain("no human approval");
    expect(outcomeExplanation(item)).toContain("not proof of crime");
    expect(outcomeExplanation({ ...item, status: "failed" })).toContain("failed");
  });
});

describe("story studio verdicts", () => {
  const story = {
    mode: "design" as const, title: "Split deposits", description: "Cash split up.", designer: "model" as const, model: "llama3.2:3b",
    latency_ms: 5000, prediction: "FILE_SAR" as const, prediction_reason: "Many deposits.", tactic: null, adjustments: [],
    injection_flags: 0, blind_spots: [], attempts: [], note: null,
    recipe: { deposit_count: 3, deposit_min: 9100, deposit_max: 9800, source_count: 3, outflow_percent: 80, round_outflow: true, return_flow: true, screened_party: false, span_days: 7 },
  };
  it("compares the locked prediction with the rule outcome", () => {
    expect(storyVerdict({ ...item, scenario: "custom", story }).tone).toBe("match");
    expect(storyVerdict({ ...item, scenario: "custom", story, recommendation: "REVIEW" }).tone).toBe("differ");
    expect(storyVerdict({ ...item, scenario: "custom", story, status: "running" }).tone).toBe("pending");
  });
  it("scores a red-team challenge from the team's point of view", () => {
    const challenge = { ...story, mode: "challenge" as const };
    expect(storyVerdict({ ...item, story: challenge, recommendation: "CLEAR" }).tone).toBe("slipped");
    expect(storyVerdict({ ...item, story: challenge, recommendation: "REVIEW" }).tone).toBe("partial");
    expect(storyVerdict({ ...item, story: challenge, recommendation: "HOLD" }).tone).toBe("caught");
  });
  it("summarises the code-built recipe in plain words", () => {
    expect(recipeSummary(story)).toEqual([
      "3 deposits of $9,100–$9,800 from 3 senders over 7 days",
      "80% sent onward as a round-thousand amount",
      "Part of the outflow comes back (circular flow)",
    ]);
  });
});
