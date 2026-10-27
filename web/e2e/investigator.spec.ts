import { expect, test } from "@playwright/test";
import { caseSchema } from "../src/lib/contracts";
import { seededCaseId } from "./test-data";

test("scripted investigator exposes exact evidence and tool provenance without claiming AI", async ({ page }) => {
  const id = seededCaseId("structuring");
  const response = await page.request.get(`/api/cases/${id}`);
  expect(response.ok()).toBe(true);
  const item = caseSchema.parse(await response.json());
  test.skip(!item.investigator, "Investigator is off; start the backend with AML_ENABLE_INVESTIGATOR=1.");
  const report = item.investigator!;
  test.skip(report.mode !== "scripted", "This scenario exercises the scripted trace; use the stub provider.");

  await page.goto(`/?case=${id}&tab=overview`);
  const panel = page.getByRole("region", { name: "Investigator trace" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Scripted · not AI");
  await expect(panel).toContainText(`${report.model_calls}`);
  expect(report.model_calls).toBe(0);
  await expect(panel.locator(".investigator-summary dd")).toHaveText(report.summary.map(f => f.text));
  await expect(panel.locator(".investigator-summary dt")).toHaveText(report.summary.map(f => f.id));
  const facts = new Map(report.steps.flatMap(step => step.facts).map(fact => [fact.id, fact.text]));
  for (const fact of report.summary) {
    expect(report.selected_ids).toContain(fact.id);
    expect(facts.get(fact.id)).toBe(fact.text);
  }
  await panel.locator("summary").click();
  await expect(panel.locator(".investigator-tools > ol > li")).toHaveCount(report.steps.length);
  const steps = panel.locator(".investigator-tools > ol > li");
  for (let n = 0; n < report.steps.length; n++) {
    const step = report.steps[n];
    expect(step.chosen_by).toBe("scripted");
    await expect(steps.nth(n)).toContainText("Scripted (not AI)");
    await expect(steps.nth(n)).toContainText(`${step.duration_ms} ms`);
    await expect(steps.nth(n)).toContainText(`${step.result_bytes} bytes returned`);
    await expect(steps.nth(n).locator("pre")).toHaveText(JSON.stringify(step.arguments, null, 2));
    await expect(steps.nth(n).locator("dd")).toHaveText(step.facts.map(f => f.text));
  }
  await expect(panel.locator(".investigator-errors li")).toHaveText(report.errors);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
