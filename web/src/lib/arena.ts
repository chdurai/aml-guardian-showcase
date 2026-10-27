import { z } from "zod";

const value = z.union([z.number(), z.string(), z.boolean(), z.null()]);
const tool = z.enum(["lookup_account", "list_transactions", "graph_neighbours",
  "sanctions_screen", "search_typologies", "search_policy"]);
const scalar = z.union([z.string(), z.number(), z.boolean()]);
export const evidenceSchema = z.strictObject({
  id: z.string(), run_id: z.string(), tool_call_id: z.string(), tool, path: z.string(),
  value, text: z.string(), source_version: z.string(), available: z.boolean(),
});
export const findingSchema = z.strictObject({
  id: z.string(), revision: z.number().int().positive(),
  kind: z.enum(["metric_equals", "screening_match_count", "transaction_count", "reference_extract"]),
  tool, path: z.string(), value, evidence_ids: z.array(z.string()),
  status: z.enum(["active", "superseded"]), supersedes_revision: z.number().int().nullable(),
});
export const challengeSchema = z.strictObject({
  id: z.string(), finding_id: z.string(), finding_revision: z.number().int(),
  check: z.enum(["unknown_id", "wrong_source", "numeric_mismatch", "conflicting_values",
    "unavailable", "required_evidence"]), severity: z.literal("critical"), evidence_ids: z.array(z.string()),
  requested_tool: tool, status: z.enum(["unresolved", "resolved", "tool_failed", "budget_exhausted"]),
  resolution_evidence_ids: z.array(z.string()),
});
export const arenaEventSchema = z.strictObject({
  sequence: z.number().int().nonnegative(), run_id: z.string(), trace_id: z.string(),
  kind: z.string(), actor: z.enum(["investigator", "critic", "tool", "validator", "fallback"]),
  timestamp: z.iso.datetime({ offset: true }), duration_ms: z.number().nonnegative(),
  details: z.record(z.string(), scalar),
});
export const trialSchema = z.strictObject({
  mode: z.enum(["model", "scripted", "fallback", "partial"]), model: z.string(), run_id: z.string(),
  objectives: z.array(z.strictObject({ id: z.string(), required_tool: tool,
    required: z.boolean(), status: z.enum(["satisfied", "missing"]) })),
  evidence: z.array(evidenceSchema), findings: z.array(findingSchema),
  challenges: z.array(challengeSchema), events: z.array(arenaEventSchema),
  initial_calls: z.number().int().nonnegative(), followup_calls: z.number().int().nonnegative(),
  tool_calls: z.number().int().nonnegative(), unnecessary_calls: z.number().int().nonnegative(),
  model_requests: z.number().int().nonnegative(), retries: z.number().int().nonnegative(),
  invalid_actions: z.number().int().nonnegative(), investigator_ms: z.number().nonnegative(),
  prompt_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  correction_ms: z.number().nonnegative(), total_ms: z.number().nonnegative(),
  result_bytes: z.number().int().nonnegative(), coverage: z.number().min(0).max(1),
  unresolved: z.number().int().nonnegative(), complete: z.boolean(), errors: z.array(z.string()),
});
export const comparisonSchema = z.strictObject({
  id: z.uuid(), fixture_id: z.string(), fixture_version: z.string(), fixture_hash: z.string(),
  seed: z.number().int(), configuration: z.record(z.string(), scalar),
  baseline: trialSchema, agent: trialSchema.nullable(),
  policy_reference: z.strictObject({ score: z.number().int(), recommendation: z.string(),
    source: z.literal("fixed_specialists") }),
  comparison_eligible: z.boolean(), exclusion_reasons: z.array(z.string()),
});
export const arenaJobSchema = z.strictObject({
  id: z.uuid(), fixture_id: z.string(), mode: z.enum(["compare", "scripted"]),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  sequence: z.number().int().nonnegative(), events: z.array(arenaEventSchema),
  report: comparisonSchema.nullable(), error: z.string().nullable(),
});
export const fixtureSchema = z.strictObject({
  id: z.string(), title: z.string(), description: z.string(), synthetic: z.literal(true), planted: z.boolean(),
});
export const createArenaSchema = z.strictObject({ fixture_id: z.string().min(1).max(80), mode: z.enum(["compare", "scripted"]) });
export type ArenaJob = z.infer<typeof arenaJobSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type Trial = z.infer<typeof trialSchema>;
