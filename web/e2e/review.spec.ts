import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ extraHTTPHeaders: { Origin: process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000" } });

test("ACC-0040 explains the handoff and records a decision with a durable outcome", async ({ page, request }) => {
  const created = await request.post("/api/cases", { data: { scenario: "review" } });
  expect(created.status()).toBe(202);
  const { id } = await created.json();
  await page.goto(`/?case=${id}&tab=overview`);
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision");
  await expect(page.getByRole("heading", { name: "ACC-0040", exact: true })).toBeVisible();
  const panel = page.locator("#decision");
  const banner = page.getByRole("region", { name: "Your action is needed" });
  await expect(banner).toContainText("Nothing else will happen");
  await banner.getByRole("button", { name: "Go to decision", exact: true }).click();
  await expect(panel).toBeFocused();
  await expect(panel).toContainText("not authenticated roles");
  await expect(panel.getByRole("button", { name: "Submit decision", exact: true })).toBeDisabled();

  await panel.getByRole("button", { name: /Check the evidence/ }).click();
  await expect(page.getByRole("heading", { name: "Evidence ledger" })).toBeInViewport();
  await banner.getByRole("button", { name: "Go to decision", exact: true }).click();
  await panel.getByRole("button", { name: /Read the draft/ }).click();
  await expect(page.getByRole("heading", { name: "Case narrative" })).toBeInViewport();
  await banner.getByRole("button", { name: "Go to decision", exact: true }).click();
  await panel.getByRole("radio", { name: /^Close with no further action/ }).check();
  await panel.getByRole("textbox", { name: /Your name/ }).fill("Practice Analyst");
  await panel.getByRole("textbox", { name: /Your rationale/ }).fill("The synthetic transfer is explained by the fixture evidence.");
  await panel.getByRole("checkbox").check();
  await expect(panel.getByRole("button", { name: /^Submit:/ })).toBeEnabled();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const scan = await new AxeBuilder({ page }).include("#decision").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  await panel.getByRole("button", { name: /^Submit:/ }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Workflow completed");
  await expect(panel).toContainText("Closed with no further action by Practice Analyst");
  await page.reload();
  await expect(panel).toContainText("The synthetic transfer is explained by the fixture evidence.");
  await expect(page.getByRole("button", { name: "Go to decision", exact: true })).toHaveCount(0);
});

test("screening explains blocked actions, escalates, and requires a different final reviewer", async ({ page, request }) => {
  const created = await request.post("/api/cases", { data: { scenario: "screening" } });
  expect(created.status()).toBe(202);
  const { id } = await created.json();
  await page.goto(`/?case=${id}&tab=overview`);
  const panel = page.locator("#decision");
  await expect(panel.getByRole("radio", { name: /^Approve SAR filing/ })).toBeDisabled();
  await expect(panel.getByRole("radio", { name: /^Close with no further action/ })).toBeDisabled();
  await expect(panel).toContainText("A screening HOLD must be resolved by a senior reviewer");
  await panel.getByRole("radio", { name: /^Escalate to a senior reviewer/ }).check();
  await panel.getByRole("textbox", { name: /Your name/ }).fill("Practice Analyst");
  await panel.getByRole("textbox", { name: /Your rationale/ }).fill("The screening indicator requires a senior review of the evidence.");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: /^Submit:/ }).click();
  await expect(panel).toContainText("Level 2");
  await expect(panel).toContainText("Escalated by Practice Analyst");
  await expect(panel.getByRole("radio", { name: /^Escalate to a senior reviewer/ })).toBeDisabled();
  await panel.getByRole("radio", { name: /^Approve SAR filing/ }).check();
  await panel.getByRole("textbox", { name: /Your name/ }).fill("practice   ANALYST");
  await panel.getByRole("textbox", { name: /Your rationale/ }).fill("The synthetic evidence supports this simulated report decision.");
  await panel.getByRole("checkbox").check();
  await expect(panel).toContainText("use a different senior reviewer");
  await expect(panel.getByRole("button", { name: /^Submit:/ })).toBeDisabled();
  await panel.getByRole("textbox", { name: /Your name/ }).fill("Practice Senior");
  await panel.getByRole("button", { name: /^Submit:/ }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Workflow completed");
  await expect(panel).toContainText("SAR filing approved by Practice Senior");
  await expect(panel).toContainText("nothing was filed");
  await expect(panel.locator(".review-trail li")).toHaveCount(2);
});

test("decision errors are visible and preserve the reviewer's input", async ({ page, request }) => {
  const created = await request.post("/api/cases", { data: { scenario: "review" } });
  expect(created.status()).toBe(202);
  const { id } = await created.json();
  await page.goto(`/?case=${id}&tab=overview`);
  const panel = page.locator("#decision");
  await panel.getByRole("radio", { name: /^Close with no further action/ }).check();
  await panel.getByRole("textbox", { name: /Your name/ }).fill("Practice Analyst");
  const rationale = "The fixture evidence explains the synthetic transaction.";
  await panel.getByRole("textbox", { name: /Your rationale/ }).fill(rationale);
  await panel.getByRole("checkbox").check();
  await page.route(`**/api/cases/${id}/decision`, route => route.fulfill({
    status: 409, contentType: "application/json", body: JSON.stringify({ detail: "This case is no longer waiting for a decision. Refresh the case." }),
  }));
  await panel.getByRole("button", { name: /^Submit:/ }).click();
  await expect(panel.getByRole("alert")).toContainText("Refresh the case");
  await expect(panel.getByRole("textbox", { name: /Your rationale/ })).toHaveValue(rationale);
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision");
});
