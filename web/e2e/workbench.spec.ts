import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { caseSchema } from "../src/lib/contracts";
import { executionSteps } from "../src/lib/investigation";
import { expectations } from "./test-data";
import { assertRecordedRoute } from "./route-expectations";

test("connected investigation, sources, navigation and responsive layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ACC-4471", exact: true })).toBeVisible();
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
  await expect(page.locator(".case-header .recommendation")).toHaveText("Report consideration");
  await expect(page.getByText("$38,300", { exact: true })).toBeVisible();
  await expect(page.getByText("$28,000", { exact: true })).toBeVisible();
  const caseUrl = page.url();
  await page.getByRole("button", { name: /^Evidence/ }).click();
  await expect(page.getByRole("heading", { name: "Evidence ledger" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.locator(".source-cards button").first().click();
  await expect(page.getByRole("dialog")).toContainText("Claim-level support has not been assessed");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Case draft", exact: true }).click();
  await expect(page.locator(".narrative")).toContainText(/\[stub-narrative\]|Facts used:/);
  await expect(page.getByText("Your decision is recorded in the decision panel, not here")).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Execution timeline" })).toBeVisible();
  await page.goto(caseUrl);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole("heading", { name: "ACC-4471", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const mainBox = await page.locator(".detail-main").boundingBox();
  const railBox = await page.locator(".context-rail").boundingBox();
  expect(mainBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(railBox!.x).toBeGreaterThan(mainBox!.x);
  expect(Math.abs(railBox!.y - mainBox!.y)).toBeLessThan(2);
  await expect(page.locator(".detail-main .journey-navigation")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(errors).toEqual([]);
});

test("evidence, draft and dialog accessibility", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await expect(page.locator(".MuiDialog-container")).toHaveCSS("opacity", "1");
  const dialogScan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(dialogScan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
  for (const tab of ["Evidence", "Case draft", "Activity"]) {
    await page.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  }
});

test("browser boundary rejects customer input and cross-origin commands", async ({ request }) => {
  const origin = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000";
  const crossOrigin = await request.post("/api/cases", { headers: { Origin: "https://other.example" }, data: { scenario: "routine" } });
  expect(crossOrigin.status()).toBe(403);
  const customer = await request.post("/api/cases", { headers: { Origin: origin }, data: { scenario: "routine", account: "customer" } });
  expect(customer.status()).toBe(422);
  expect((await request.get("/api/cases/not-a-uuid")).status()).toBe(404);
});

test("routine and screening routes are honest about lifecycle", async ({ page }) => {
  for (const [scenario, account, recommendation, status] of [
    ["Routine transfer", "ACC-0001", "No escalation recommended", "Workflow completed"],
    ["Screening indicator", "ACC-9999", "Hold · resolution required", "Needs your decision"],
    ["Needs a closer look", "ACC-0040", "Review recommended", "Needs your decision"],
  ]) {
    await page.goto("/");
    await page.getByRole("button", { name: "New investigation", exact: true }).click();
    await page.getByRole("radio", { name: new RegExp(scenario) }).check();
    await page.getByRole("button", { name: "Run investigation", exact: true }).click();
    await expect(page.getByRole("heading", { name: account, exact: true })).toBeVisible();
    await expect(page.locator(".case-header .status")).toHaveText(status);
    await expect(page.locator(".case-header .recommendation")).toHaveText(recommendation);
  }
});

test("lost connection is explicit and last snapshot is marked stale", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
  await page.route("**/api/cases/**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "API disconnected for test." }) }));
  await page.getByRole("button", { name: "Refresh cases" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Last snapshot may be out of date" })).toBeVisible();
  await expect(page.getByText("Connection lost · stale snapshot")).toBeVisible();
});

test("first-time user can follow the guided journey and return to a case", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start here: usage guide" })).toHaveAttribute("href", "/usage-guide.html");
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
  await expect(page.getByRole("region", { name: "Result explained" })).toContainText("Next step is yours");
  await expect(page.getByText("Net observed flow:", { exact: false })).toContainText("$10,300");
  await page.getByText("Why this score? See the rule breakdown", { exact: true }).click();
  await expect(page.locator(".score-explanation dd")).toHaveText(["+50", "+20", "+25", "+30", "+10"]);
  await page.getByRole("button", { name: "Continue to Evidence", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence ledger" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Case draft", exact: true }).click();
  await expect(page.getByText("Your decision is recorded in the decision panel, not here")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Execution timeline" })).toBeVisible();
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search cases" }).fill("does-not-exist");
  await expect(page.getByText("No matching cases", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search cases" }).fill("ACC-4471");
  await expect(page.locator(".case-row").first()).toContainText("ACC-4471");
  await page.getByRole("combobox", { name: "Filter case lifecycle" }).selectOption("completed");
  await expect(page.getByText("No matching cases", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter case lifecycle" }).selectOption("awaiting_human");
  await expect(page.locator(".case-row").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Search cases" }).fill("ACC-4471");
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByRole("radio", { name: /^Routine transfer/ }).check();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ACC-0001", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search cases" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Filter case lifecycle" })).toHaveValue("all");
  await expect(page.locator(".case-row.selected")).toContainText("ACC-0001");
});

test("beginner guide works on desktop and phone, with accessible navigation", async ({ page }) => {
  const response = await page.goto("/usage-guide.html");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("No banking background needed");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("link", { name: "Four practice stories", exact: true }).click();
  await expect(page).toHaveURL(/#practice$/);
  await expect(page.getByRole("heading", { name: "3. Try all four practice stories" })).toBeInViewport();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});

test("missing cases are explicit and source dialogs explain their boundaries", async ({ page }) => {
  await page.goto("/?case=00000000-0000-4000-8000-000000000000&tab=evidence");
  await expect(page.getByRole("heading", { name: "Case unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic case not found" })).toBeVisible();
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
  await page.getByRole("button", { name: "Continue to Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Screening method", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("not a sanctions/PEP service");
  await page.keyboard.press("Escape");
  await page.locator(".source-cards button").first().click();
  await expect(page.locator(".MuiDialog-container")).toHaveCSS("opacity", "1");
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});

test("recorded specialist contributions, measured durations and scenario routes agree", async ({ page }) => {
  for (const scenario of ["Transfer pattern", "Routine transfer", "Screening indicator", "Needs a closer look"]) {
    await page.goto("/");
    await page.getByRole("button", { name: "New investigation", exact: true }).click();
    await page.getByRole("radio", { name: new RegExp(`^${scenario}`) }).check();
    await page.getByRole("button", { name: "Run investigation", exact: true }).click();
    await expect(page.locator(".case-header .status")).not.toHaveText("Investigating");
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How the specialists worked together" })).toBeVisible();
    const id = new URL(page.url()).searchParams.get("case");
    const snapshot = caseSchema.parse(await (await page.request.get(`/api/cases/${id}`)).json());
    const golden = expectations.find(item => item.title === scenario)!;
    const route = assertRecordedRoute(snapshot, golden.route);
    await expect(page.locator(".agent-path li")).toHaveCount(route.length);
    await expect(page.locator(".agent-detail")).toContainText("Case " + snapshot.graph_case_id);
    const measured = executionSteps(snapshot).reduce((sum, step) => sum + (step.end?.duration_ms ?? 0), 0);
    await expect(page.locator(".run-facts")).toContainText(`${measured.toFixed(2)} ms`);
    if (scenario === "Routine transfer") {
      await expect(page.locator(".agent-path")).not.toContainText("Evidence critic");
      await page.locator(".agent-path button").last().click();
      await expect(page.locator(".agent-detail")).toContainText("no human approval recorded");
      await expect(page.locator(".route-explanation")).toContainText("automatic closure");
    } else {
      await page.locator(".agent-path button").filter({ hasText: "Evidence critic" }).click();
      await expect(page.locator(".agent-detail")).toContainText("0 challenges");
      await expect(page.locator(".agent-detail")).toContainText("does not check factual support");
      await page.getByRole("button", { name: "Next agent", exact: true }).click();
      await expect(page.locator(".agent-detail")).toContainText("Narrative writer");
      await page.getByRole("button", { name: "Next agent", exact: true }).click();
      await expect(page.locator(".agent-detail")).toContainText("No human decision has been recorded");
      await expect(page.getByRole("button", { name: "Next agent", exact: true })).toBeDisabled();
    }
    if (scenario === "Screening indicator") {
      await page.locator(".agent-path button").filter({ hasText: "Policy scorer" }).click();
      await expect(page.locator(".agent-detail")).toContainText("transaction scoring was bypassed");
    }
  }
  await page.getByRole("button", { name: "Compare scenarios", exact: true }).click();
  await expect(page.locator(".comparison-card")).toHaveCount(4);
  await expect(page.locator(".comparison-card").filter({ hasText: "Needs a closer look" })).toContainText("Review recommended");
  await expect(page.locator(".comparison-card").filter({ hasText: "Routine transfer" })).toContainText("automatic closure");
  await expect(page.locator(".MuiDialog-container")).toHaveCSS("opacity", "1");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.locator(".comparison-card").filter({ hasText: "Transfer pattern" }).getByRole("button", { name: "Open recorded run" }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await expect(page.locator(".case-header .recommendation")).toHaveText("Report consideration");
});

test("unrun comparison scenarios stay explicit and can be launched deliberately", async ({ page }) => {
  await page.route("**/api/cases", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Compare scenarios", exact: true }).click();
  await expect(page.getByText("Not run yet", { exact: true })).toHaveCount(4);
  await page.locator(".comparison-card").filter({ hasText: "Needs a closer look" }).getByRole("button", { name: "Try this scenario" }).click();
  await expect(page.getByRole("radio", { name: /^Needs a closer look/ })).toBeChecked();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ACC-0040", exact: true })).toBeVisible();
  await expect(page.locator(".case-header .recommendation")).toHaveText("Review recommended");
  await expect(page.locator(".metric-card").first()).toContainText("40");
});
