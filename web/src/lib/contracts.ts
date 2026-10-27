import { z } from "zod";

export const scenarioSchema = z.enum(["structuring", "routine", "screening", "review"]);
export type Scenario = z.infer<typeof scenarioSchema>;
export const createCaseSchema = z.object({ scenario: scenarioSchema }).strict();
export const eventSchema = z.object({
  sequence: z.number().int(), node: z.string(),
  phase: z.enum(["started", "completed"]), timestamp: z.string(),
  summary: z.array(z.string()), evidence_ids: z.array(z.string()),
  duration_ms: z.number().nonnegative().nullable(),
});
const sentenceSchema = z.object({ text: z.string(), facts: z.array(z.string()), status: z.enum(["verified", "rejected"]), issues: z.array(z.string()) });
export const groundingSchema = z.object({
  mode: z.enum(["model", "fallback"]), provider: z.string(), model: z.string(),
  attempts: z.number().int(), latency_ms: z.number().nonnegative(),
  prompt_tokens: z.number().int(), output_tokens: z.number().int(),
  accepted: z.number().int(), rejected: z.number().int(), error: z.string().nullable(),
  facts: z.array(z.object({ id: z.string(), agent: z.string(), text: z.string() })),
  sentences: z.array(sentenceSchema),
  earlier_rejected: z.array(sentenceSchema).default([]),
});
export type Grounding = z.infer<typeof groundingSchema>;
export const runtimeSchema = z.object({
  provider: z.string(), model: z.string(), family: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(), license: z.string().nullable().optional(),
  reachable: z.boolean().nullable().optional(), installed: z.boolean().nullable().optional(),
});
export type Runtime = z.infer<typeof runtimeSchema>;
const recommendationSchema = z.enum(["CLEAR", "REVIEW", "FILE_SAR", "HOLD"]);
export const createStorySchema = z.object({
  mode: z.enum(["design", "challenge"]),
  description: z.string().trim().max(400).default(""),
}).strict().refine(v => v.mode === "challenge" || v.description.length >= 12, { message: "Describe the story in at least a few words." });
export const storySchema = z.object({
  mode: z.enum(["design", "challenge"]), title: z.string(), description: z.string(),
  recipe: z.object({
    deposit_count: z.number().int(), deposit_min: z.number(), deposit_max: z.number(), source_count: z.number().int(),
    outflow_percent: z.number(), round_outflow: z.boolean(), return_flow: z.boolean(), screened_party: z.boolean(), span_days: z.number().int(),
  }),
  designer: z.enum(["model", "fallback"]), model: z.string(), latency_ms: z.number().nonnegative(),
  prediction: recommendationSchema, prediction_reason: z.string(), tactic: z.string().nullable(),
  adjustments: z.array(z.string()), injection_flags: z.number().int(), blind_spots: z.array(z.string()),
  attempts: z.array(z.object({
    round: z.number().int(), title: z.string(), tactic: z.string(), score: z.number(), recommendation: recommendationSchema,
    triggered: z.array(z.string()), moved: z.number(), valid: z.boolean(), investigated: z.boolean(),
  })).default([]),
  note: z.string().nullable(),
});
export type Story = z.infer<typeof storySchema>;
const investigatorFactSchema = z.object({ id: z.string(), text: z.string() });
export const investigatorSchema = z.object({
  mode: z.enum(["model", "fallback", "scripted", "partial"]), model: z.string(),
  steps: z.array(z.object({
    tool: z.string(), arguments: z.record(z.string(), z.string()),
    chosen_by: z.enum(["model", "scripted"]),
    duration_ms: z.number().nonnegative(), result_bytes: z.number().int().nonnegative(),
    facts: z.array(investigatorFactSchema),
  })),
  selected_ids: z.array(z.string()), summary: z.array(investigatorFactSchema),
  errors: z.array(z.string()), latency_ms: z.number().nonnegative(),
  model_calls: z.number().int().nonnegative(), invalid_calls: z.number().int().nonnegative(),
});
export type Investigator = z.infer<typeof investigatorSchema>;
export const reviewActionSchema = z.enum(["APPROVE_SAR", "DISMISS", "ESCALATE"]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export const reviewRecordSchema = z.object({
  level: z.number().int(), action: reviewActionSchema, label: z.string(),
  reviewer: z.string(), rationale: z.string(), recorded_at: z.string(),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
export const pendingReviewSchema = z.object({
  level: z.number().int(), role: z.string(), question: z.string(),
  options: z.array(z.object({
    action: reviewActionSchema, label: z.string(), consequence: z.string(),
    allowed: z.boolean(), blocked_reason: z.string().nullable(),
  })),
  checklist: z.array(z.string()), previous: reviewRecordSchema.nullable(),
});
export type PendingReview = z.infer<typeof pendingReviewSchema>;
export const normalizeReviewText = (value: string) => value.trim().replace(/\s+/g, " ");
export const decisionSchema = z.object({
  action: reviewActionSchema,
  reviewer: z.string().transform(normalizeReviewText).pipe(z.string().min(2).max(60)),
  rationale: z.string().transform(normalizeReviewText).pipe(z.string().min(20).max(1000)),
  evidence_reviewed: z.literal(true),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
export const caseSchema = z.object({
  id: z.string(), scenario: z.union([scenarioSchema, z.literal("custom")]), account: z.string(),
  originator: z.string(), beneficiary: z.string(), window: z.string(),
  currency: z.string(), created_at: z.string(), updated_at: z.string(),
  status: z.enum(["running", "awaiting_human", "completed", "failed"]),
  graph_case_id: z.string().nullable(), recommendation: recommendationSchema.nullable(),
  score: z.number().nullable(),
  transactions: z.array(z.object({ source: z.string(), target: z.string(), amount: z.number(), timestamp: z.string() })),
  findings: z.array(z.object({ agent: z.string(), claim: z.string(), evidence_ids: z.array(z.string()) })),
  sources: z.array(z.object({ id: z.string(), source: z.string(), text: z.string() })),
  metrics: z.object({ nodes: z.number(), fan_in: z.number(), cycles: z.number(), structuring_hits: z.number() }),
  narrative: z.string(), grounding: groundingSchema.nullable().optional(), events: z.array(eventSchema), error: z.string().nullable(),
  story: storySchema.nullable().optional(),
  investigator: investigatorSchema.nullable().optional(),
  review: pendingReviewSchema.nullable().optional(),
  reviews: z.array(reviewRecordSchema).default([]),
  disposition: z.string().nullable().optional(),
});
export type Case = z.infer<typeof caseSchema>;
export const policyQuestionSchema = z.object({
  question: z.string().trim().min(5).max(400),
  case_id: z.string().min(1).max(80).optional(),
}).strict();
const policyPassageSchema = z.object({
  id: z.string(), title: z.string(), text: z.string(),
  url: z.url().nullable(), kind: z.enum(["public_guidance_summary", "demo_rule_note"]),
  relevance: z.number().nonnegative(),
});
export const policyAnswerSchema = z.object({
  question: z.string(), mode: z.enum(["model_selected", "extractive", "abstained"]),
  model: z.string(), corpus_version: z.string(),
  passages: z.array(policyPassageSchema), retrieved: z.array(policyPassageSchema),
  case_context: z.object({
    id: z.string(), account: z.string(), status: z.string(),
    score: z.number().nullable(), recommendation: recommendationSchema.nullable(),
    signals: z.array(z.string()),
  }).nullable(),
  trace: z.array(z.string()), note: z.string(),
  injection_flags: z.number().int().nonnegative(), rejected_ids: z.array(z.string()),
  selected_ids: z.array(z.string()),
});
export type PolicyAnswer = z.infer<typeof policyAnswerSchema>;
export const statusLabels: Record<Case["status"], string> = {
  running: "Investigating", awaiting_human: "Needs your decision",
  completed: "Workflow completed", failed: "Investigation failed",
};
export const recommendations = {
  CLEAR: "No escalation recommended", REVIEW: "Review recommended",
  FILE_SAR: "Report consideration", HOLD: "Hold · resolution required",
};
export const scenarios: { id: Scenario; title: string; detail: string }[] = [
  { id: "structuring", title: "Transfer pattern", detail: "Multiple sources, sub-threshold deposits and a circular transfer." },
  { id: "routine", title: "Routine transfer", detail: "A single synthetic employer transfer with no escalation." },
  { id: "screening", title: "Screening indicator", detail: "Exercise the illustrative name-match and internal HOLD route." },
  { id: "review", title: "Needs a closer look", detail: "One $9,500 transfer: score 40, human review recommended—not report consideration." },
];
