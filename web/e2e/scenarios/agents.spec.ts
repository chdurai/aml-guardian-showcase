import { caseSnapshot, expect, expected, openSeeded, openTab, meta, test, step } from "./support";
import { narrate } from "../demo-controls";
import { expectations, seededCaseId } from "../test-data";
import { assertRecordedRoute } from "../route-expectations";
import { caseSchema } from "../../src/lib/contracts";

test(...meta("agent-team"), async ({ page }) => {
  const want = expected("structuring");
  let id = "";
  let route: string[] = [];
  await step(page, `Open ${want.account} and go to Activity`, async () => {
    id = await openSeeded(page, "structuring");
    await openTab(page, "Activity");
    await expect(page.getByRole("heading", { name: "How the specialists worked together" })).toBeVisible();
  });
  await step(page, "The recorded path preserves the fixture route, plus the investigator when enabled", async () => {
    route = assertRecordedRoute(await caseSnapshot(page, id), want.route);
    await expect(page.locator(".agent-path li")).toHaveCount(route.length);
  });
  await step(page, "Walk through every specialist with Next agent", async () => {
    await page.locator(".agent-path button").first().click();
    const next = page.getByRole("button", { name: "Next agent", exact: true });
    const seen: string[] = [];
    for (let n = 1; n <= route.length; n++) {
      const title = await page.locator(".agent-detail-heading h4").innerText();
      seen.push(title);
      await narrate(page, `Agent ${n} of ${route.length}: ${title} — what it received and what it recorded`);
      if (n < route.length) await next.click();
    }
    await expect(next).toBeDisabled();
    expect(new Set(seen).size).toBe(route.length);
    await page.getByRole("button", { name: "Previous agent", exact: true }).click();
    await expect(page.locator(".agent-detail-heading h4")).toHaveText(seen.at(-2)!);
  });
  await step(page, "The execution timeline shows measured durations for each step", async () => {
    await expect(page.getByRole("heading", { name: "Execution timeline" })).toBeVisible();
    await expect(page.locator(".run-facts")).toContainText("ms");
  });
});

test(...meta("compare-paths"), async ({ page }) => {
  let latestScreeningId = "";
  await step(page, "Open the comparison: same team, four recorded runs", async () => {
    await page.goto("/");
    const response = await page.request.get("/api/cases");
    expect(response.ok()).toBe(true);
    const cases = caseSchema.array().parse(await response.json());
    const latest = cases.filter(item => item.scenario === "screening")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    expect(latest, "Comparison must open the most recent screening run, not necessarily the seeded one").toBeDefined();
    latestScreeningId = latest.id;
    await page.getByRole("button", { name: "Compare scenarios", exact: true }).click();
    await expect(page.locator(".comparison-card")).toHaveCount(expectations.length);
    await expect(page.getByText("Not run yet", { exact: true })).toHaveCount(0);
    for (const want of expectations)
      await expect(page.locator(".comparison-card").filter({ hasText: want.title })).toContainText(want.recommendationLabel);
  });
  await step(page, "Jump into the screening hold from its card", async () => {
    const want = expected("screening");
    await page.locator(".comparison-card").filter({ hasText: want.title }).getByRole("button", { name: "Open recorded run" }).click();
    await expect(page.getByRole("heading", { name: want.account, exact: true })).toBeVisible();
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await expect(page).toHaveURL(new RegExp(`[?&]case=${latestScreeningId}(?:&|$)`));
    const opened = caseSchema.parse(await caseSnapshot(page, latestScreeningId));
    expect(opened.scenario).toBe("screening");
    expect(opened.recommendation).toBe(want.recommendation);
  });
});

type Sentence = { status: string; facts: string[] };
type Grounding = { mode: string; model: string; facts: { id: string }[]; sentences: Sentence[]; earlier_rejected: Sentence[]; accepted: number };

test(...meta("ai-draft-verifier"), async ({ page }, testInfo) => {
  const runtime = await (await page.request.get("/api/runtime")).json();
  if (runtime.provider === "stub") {
    await step(page, "Local AI model is off — the draft says so instead of pretending", async () => {
      await openSeeded(page, "structuring");
      await openTab(page, "Case draft");
      await expect(page.locator(".section-heading .MuiChip-root")).toHaveText("Stub narration");
      await expect(page.getByRole("region", { name: "AI writes, code verifies" })).toHaveCount(0);
      await expect(page.locator(".environment-note")).toContainText("stub narration");
    });
    testInfo.annotations.push({ type: "Tip", description: "Start the API with AML_LLM_PROVIDER=ollama to watch the local model draft and the verifier check it." });
    return;
  }
  const drafted = expectations.filter(e => e.recommendation !== "CLEAR");
  const grounded: { scenario: typeof drafted[number]["scenario"]; g: Grounding }[] = [];
  for (const want of drafted)
    grounded.push({ scenario: want.scenario, g: (await caseSnapshot(page, seededCaseId(want.scenario))).grounding });
  const showcase = grounded.find(x => x.g.earlier_rejected.length || x.g.sentences.some(s => s.status === "rejected")) ?? grounded[0];
  const want = expected(showcase.scenario);
  const g = showcase.g;

  await step(page, `Open the ${want.account} draft written by the local model`, async () => {
    await openSeeded(page, showcase.scenario);
    await openTab(page, "Case draft");
    await expect(page.locator(".environment-note")).toContainText("local model");
    await expect(page.locator(".section-heading .MuiChip-root")).toHaveText(g.mode === "model" ? /^Local model · / : "Verified fact template");
  });
  const panel = page.getByRole("region", { name: "AI writes, code verifies" });
  await step(page, "The panel shows the model, verified and excluded counts, attempts and timing", async () => {
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator(".grounding-stats")).toContainText(`${g.accepted} verified`);
    await expect(panel.locator(".grounding-stats")).toContainText(/attempts?/);
  });
  await step(page, "Every accepted sentence carries the fact IDs it relies on", async () => {
    const known = new Set(g.facts.map(f => f.id));
    const verified = panel.locator(".grounded-sentences li.verified");
    await expect(verified).toHaveCount(g.sentences.filter(s => s.status === "verified").length);
    for (const s of g.sentences.filter(s => s.status === "verified")) {
      expect(s.facts.length).toBeGreaterThan(0);
      for (const f of s.facts) expect(known.has(f)).toBe(true);
    }
  });
  const caught = g.earlier_rejected.length + g.sentences.filter(s => s.status === "rejected").length;
  await step(page, caught ? `The verifier caught ${caught} sentence(s) — shown with the reason, not hidden` : "The model's first draft passed every check this time", async () => {
    if (g.earlier_rejected.length) await expect(panel.locator(".sentences-heading.caught")).toBeVisible();
    await expect(panel.locator(".sentence-issues")).toHaveCount(caught);
    if (!caught) testInfo.annotations.push({ type: "Note", description: "No sentence was excluded in this run; local model output varies between runs." });
  });
  await step(page, "Open the verified facts the model was allowed to use", async () => {
    await panel.locator(".facts-toggle").click();
    await expect(panel.locator(".grounding-facts dt")).toHaveCount(g.facts.length);
    await expect(panel).not.toContainText(/<<<|UNTRUSTED/);
  });
});
