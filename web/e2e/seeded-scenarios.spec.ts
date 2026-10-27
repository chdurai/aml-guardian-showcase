import { expect, test } from "@playwright/test";
import { expectations, money, seededCaseId } from "./test-data";
import { assertRecordedRoute } from "./route-expectations";

// Data-driven checks: the queue is preloaded by global setup, so nothing is created here.
for (const expected of expectations) {
  test(`seeded ${expected.scenario} case matches its golden expectations`, async ({ page }) => {
    const id = seededCaseId(expected.scenario);
    await page.goto("/");
    const row = page.locator(`.case-row[href*="${id}"]`);
    await expect(row).toContainText(expected.account);
    await expect(row).toContainText(expected.recommendationLabel);
    await row.click();
    await expect(page.getByRole("heading", { name: expected.account, exact: true })).toBeVisible();
    await expect(page.locator(".case-header .status")).toHaveText(expected.statusLabel);
    await expect(page.locator(".case-header .recommendation")).toHaveText(expected.recommendationLabel);
    await expect(page.locator(".metric-card").first().locator("strong")).toHaveText(`${expected.score}/100`);
    await expect(page.locator(".money-flow > div").first().locator("strong")).toHaveText(money(expected.incoming));
    await expect(page.locator(".money-flow > div").last().locator("strong")).toHaveText(money(expected.outgoing));

    await page.getByRole("button", { name: "Activity", exact: true }).click();
    const snapshot = await (await page.request.get(`/api/cases/${id}`)).json();
    const route = assertRecordedRoute(snapshot, expected.route);
    await expect(page.locator(".agent-path li")).toHaveCount(route.length);
  });
}

test("comparison shows every seeded scenario without running anything new", async ({ page }) => {
  const before = (await (await page.request.get("/api/cases")).json()).length;
  await page.goto("/");
  await page.getByRole("button", { name: "Compare scenarios", exact: true }).click();
  await expect(page.locator(".comparison-card")).toHaveCount(expectations.length);
  await expect(page.getByText("Not run yet", { exact: true })).toHaveCount(0);
  for (const expected of expectations)
    await expect(page.locator(".comparison-card").filter({ hasText: expected.title })).toContainText(expected.recommendationLabel);
  expect((await (await page.request.get("/api/cases")).json()).length).toBe(before);
});
