import { describe, expect, it } from "vitest";
import { caseSchema, createCaseSchema, createStorySchema, decisionSchema, groundingSchema, investigatorSchema, policyAnswerSchema, policyQuestionSchema, recommendations, runtimeSchema, scenarios } from "./contracts";

describe("synthetic intake boundary", () => {
  it("accepts only supported fixtures and rejects extra customer fields", () => {
    for (const scenario of scenarios) expect(createCaseSchema.safeParse({ scenario: scenario.id }).success).toBe(true);
    expect(createCaseSchema.safeParse({ scenario: "live" }).success).toBe(false);
    expect(createCaseSchema.safeParse({ scenario: "routine", account: "customer" }).success).toBe(false);
  });
  it("does not present report consideration as filing", () => {
    expect(recommendations.FILE_SAR).toBe("Report consideration");
  });
  it("rejects incomplete or unrecognized snapshots", () => {
    expect(caseSchema.safeParse({ id: "case-1", status: "approved" }).success).toBe(false);
  });
});

describe("grounded narration contract", () => {
  const grounding = {
    mode: "model", provider: "ollama", model: "llama3.2:3b", attempts: 1, latency_ms: 9000,
    prompt_tokens: 900, output_tokens: 120, accepted: 1, rejected: 1, error: null, earlier_rejected: [],
    facts: [{ id: "F1", agent: "graph_analysis", text: "Fan-in 4." }],
    sentences: [{ text: "Fan-in was 4.", facts: ["F1"], status: "verified", issues: [] },
      { text: "The customer is guilty.", facts: ["F1"], status: "rejected", issues: ["asserts guilt"] }],
  };
  it("accepts verified and rejected sentences with reasons", () => {
    expect(groundingSchema.safeParse(grounding).success).toBe(true);
  });

  describe("investigator trace contract", () => {
    const report = {
      mode: "scripted", model: "stub", steps: [{
        tool: "transactions", arguments: { account: "ACC-4471" }, chosen_by: "scripted",
        duration_ms: 2, result_bytes: 120, facts: [{ id: "T1", text: "Four incoming transfers." }],
      }], selected_ids: ["T1"], summary: [{ id: "T1", text: "Four incoming transfers." }],
      errors: [], latency_ms: 3, model_calls: 0, invalid_calls: 0,
    };
    it("accepts all honest execution modes and preserves exact evidence and string arguments", () => {
      for (const mode of ["model", "fallback", "scripted", "partial"]) {
        const parsed = investigatorSchema.parse({ ...report, mode });
        expect(parsed.summary).toEqual(report.summary);
        expect(parsed.steps[0].arguments).toEqual({ account: "ACC-4471" });
      }
    });
    it("accepts disabled and legacy snapshots and preserves enabled reports", () => {
      expect(caseSchema.shape.investigator.parse(null)).toBeNull();
      expect(caseSchema.shape.investigator.parse(undefined)).toBeUndefined();
      expect(caseSchema.shape.investigator.parse(report)).toEqual(report);
    });
    it("rejects unknown modes, invented chooser states and malformed trace metrics", () => {
      expect(investigatorSchema.safeParse({ ...report, mode: "approved" }).success).toBe(false);
      for (const change of [
        { chosen_by: "AI" }, { arguments: { limit: 10 } }, { duration_ms: -1 }, { result_bytes: 1.5 },
      ]) expect(investigatorSchema.safeParse({ ...report, steps: [{ ...report.steps[0], ...change }] }).success).toBe(false);
      expect(investigatorSchema.safeParse({ ...report, invalid_calls: -1 }).success).toBe(false);
    });
    it("retains partial evidence, rejection reasons and invalid-call counts", () => {
      const partial = { ...report, mode: "partial", errors: ["Unknown tool rejected"], invalid_calls: 1 };
      expect(investigatorSchema.parse(partial)).toEqual(partial);
    });
  });
  it("rejects unknown sentence states and modes", () => {
    expect(groundingSchema.safeParse({ ...grounding, mode: "approved" }).success).toBe(false);
    expect(groundingSchema.safeParse({ ...grounding, sentences: [{ ...grounding.sentences[0], status: "filed" }] }).success).toBe(false);
  });
  it("describes the runtime without secrets", () => {
    expect(runtimeSchema.safeParse({ provider: "ollama", model: "llama3.2:3b", publisher: "Meta (US)", reachable: true }).success).toBe(true);
  });
});

describe("story studio contract", () => {
  it("requires a description to design but not to challenge, and rejects extra fields", () => {
    expect(createStorySchema.safeParse({ mode: "design", description: "too short" }).success).toBe(false);
    expect(createStorySchema.safeParse({ mode: "design", description: "Cash split into many small deposits." }).success).toBe(true);
    expect(createStorySchema.safeParse({ mode: "challenge" }).success).toBe(true);
    expect(createStorySchema.safeParse({ mode: "challenge", account: "real" }).success).toBe(false);
    expect(createStorySchema.safeParse({ mode: "design", description: "x".repeat(401) }).success).toBe(false);
  });

  describe("policy reference contracts", () => {
    it("accepts bounded questions and optional case context, never customer fields", () => {
      expect(policyQuestionSchema.safeParse({ question: "Explain sanctions screening" }).success).toBe(true);
      expect(policyQuestionSchema.safeParse({ question: "Explain this case", case_id: "case-1" }).success).toBe(true);
      for (const question of ["    ", "x".repeat(401)])
        expect(policyQuestionSchema.safeParse({ question }).success).toBe(false);
      expect(policyQuestionSchema.safeParse({ question: "Explain SAR", account: "real" }).success).toBe(false);
    });
    it("requires source provenance and distinguishes abstention from an answer", () => {
      const answer = { question: "What is the weather?", mode: "abstained", model: "stub",
        corpus_version: "2026-10-24", passages: [], retrieved: [], case_context: null,
        trace: [], note: "No matching reference", injection_flags: 0, rejected_ids: [], selected_ids: [] };
      expect(policyAnswerSchema.safeParse(answer).success).toBe(true);
      expect(policyAnswerSchema.safeParse({ ...answer, mode: "approved" }).success).toBe(false);
      expect(policyAnswerSchema.safeParse({ ...answer, passages: [{ id: "fake", text: "File now" }] }).success).toBe(false);
    });
  });
});

describe("decision contract", () => {
  const valid = { action: "ESCALATE", reviewer: "Ana Analyst", rationale: "Deposits sit just below the threshold.", evidence_reviewed: true };
  it("accepts a complete reviewer decision", () => expect(decisionSchema.safeParse(valid).success).toBe(true));
  it("normalizes whitespace before checking required lengths", () => {
    expect(decisionSchema.parse({ ...valid, reviewer: " Ana   Analyst " }).reviewer).toBe("Ana Analyst");
    expect(decisionSchema.safeParse({ ...valid, rationale: `short${" ".repeat(30)}` }).success).toBe(false);
  });
  it.each([
    { ...valid, evidence_reviewed: false }, { ...valid, rationale: "too short" },
    { ...valid, action: "EDIT" }, { ...valid, score: 0 }, { ...valid, reviewer: " " },
  ])("rejects an incomplete or widened decision %#", input => expect(decisionSchema.safeParse(input).success).toBe(false));
});
