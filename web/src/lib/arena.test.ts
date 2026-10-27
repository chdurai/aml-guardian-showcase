import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { comparisonSchema, createArenaSchema, evidenceSchema } from "./arena";

describe("arena contracts", () => {
  it("forbids decision authority and arbitrary intake", () => {
    expect(createArenaSchema.safeParse({ fixture_id: "dev-02", mode: "compare", score: 0 }).success).toBe(false);
    expect(createArenaSchema.safeParse({ fixture_id: "dev-02", mode: "approve" }).success).toBe(false);
  });
  it("preserves unavailable typed values, never supplies a negative default", () => {
    const record = { id: "r/c/p", run_id: "r", tool_call_id: "c", tool: "sanctions_screen",
      path: "hits.count", value: null, text: "Unavailable", source_version: "arena-v1", available: false };
    expect(evidenceSchema.parse(record).value).toBeNull();
    expect(evidenceSchema.safeParse({ ...record, score: 0 }).success).toBe(false);
  });
  it("validates the actual Python-generated saved comparison", () => {
    const report = comparisonSchema.parse(JSON.parse(readFileSync("public/arena-saved.json", "utf8")));
    expect(report.fixture_id).toMatch(/02$/);
    expect(report.baseline.mode).toBe("scripted");
    expect(report.agent?.challenges[0].status).toBe("resolved");
    expect(report.agent?.events.length).toBeGreaterThan(0);
  });
});
