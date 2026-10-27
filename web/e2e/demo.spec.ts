import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { narrate, startDemo, withoutOverlay } from "./demo-controls";
import { expectations, seededCaseId } from "./test-data";
import { assertRecordedRoute } from "./route-expectations";

// Narrated walkthrough of the preloaded cases. `npm run demo:e2e` plays it in a visible
// browser with a caption bar and Pause/Resume button; screenshots go to the HTML report.
async function capture(page: Page, testInfo: TestInfo, name: string, focus?: Locator) {
  if (focus) await focus.evaluate(el => el.scrollIntoView({ block: "start" }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  const body = await withoutOverlay(page, () => page.screenshot());
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startDemo(page);
});

for (const [index, expected] of expectations.entries()) {
  test(`walkthrough: ${expected.title} (${expected.account})`, async ({ page }, testInfo) => {
    const id = seededCaseId(expected.scenario);
    const story = `Story ${index + 1} of ${expectations.length} — ${expected.title}`;

    await test.step("Open the preloaded case from the queue", async () => {
      await page.goto("/");
      await narrate(page, `${story}: the queue already holds four cases that were run through the real workflow.`);
      await page.locator(`.case-row[href*="${id}"]`).click();
      await expect(page.locator(".case-header .recommendation")).toHaveText(expected.recommendationLabel);
      await capture(page, testInfo, `1-overview-${expected.scenario}`);
      await narrate(page, `${expected.account}: rule score ${expected.score}/100 → “${expected.recommendationLabel}”, status “${expected.statusLabel}”.`);
    });

    await test.step("Follow the guided journey: evidence and draft", async () => {
      await page.getByRole("button", { name: "Continue to Evidence", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Evidence ledger" })).toBeVisible();
      await capture(page, testInfo, `2-evidence-${expected.scenario}`, page.locator(".case-header"));
      await narrate(page, "Evidence: every finding lists the agent that produced it and the evidence references behind it.");
      await page.getByRole("button", { name: "Continue to Case draft", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
      await capture(page, testInfo, `3-draft-${expected.scenario}`, page.locator(".case-header"));
      await narrate(page, "Case draft: a read-only narrative. With a local model, each sentence cites verified facts and code rejects anything unsupported. Nothing is filed.");
    });

    await test.step("Step through all agents that actually ran", async () => {
      const snapshot = await (await page.request.get(`/api/cases/${id}`)).json();
      const route = assertRecordedRoute(snapshot, expected.route);
      await page.getByRole("button", { name: "Continue to Activity", exact: true }).click();
      const heading = page.getByRole("heading", { name: "How the specialists worked together" });
      await expect(heading).toBeVisible();
      await heading.evaluate(el => el.scrollIntoView({ block: "start" }));
      await expect(page.locator(".agent-path li")).toHaveCount(route.length);
      await narrate(page, `Activity: this run visited ${route.length} specialist steps. Walking through each one.`);
      await page.locator(".agent-path button").first().click();
      const next = page.getByRole("button", { name: "Next agent", exact: true });
      for (let step = 1; step <= route.length; step++) {
        const title = await page.locator(".agent-detail-heading h4").innerText();
        await narrate(page, `Agent ${title} — see what it received and what it recorded.`);
        if (step < route.length) {
          await expect(next).toBeEnabled();
          await next.click();
        }
      }
      await expect(next).toBeDisabled();
      await capture(page, testInfo, `4-agents-${expected.scenario}`, heading);
    });
  });
}

test("walkthrough: compare all four recorded routes", async ({ page }, testInfo) => {
  await page.goto("/");
  await narrate(page, "Finally: one specialist team, four different decision paths.");
  await page.getByRole("button", { name: "Compare scenarios", exact: true }).click();
  await expect(page.locator(".MuiDialog-container")).toHaveCSS("opacity", "1");
  for (const expected of expectations)
    await expect(page.locator(".comparison-card").filter({ hasText: expected.title })).toContainText(expected.recommendationLabel);
  await capture(page, testInfo, "5-comparison");
  await narrate(page, "Compare: CLEAR closes automatically; REVIEW, report consideration and HOLD stop at the human checkpoint. Demo complete.");
});
