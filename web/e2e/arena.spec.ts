import { test, expect } from "@playwright/test";

test("planted wrong number is corrected with explicit scripted labels", async ({ page }) => {
  await page.goto("/arena");
  await expect(page.getByRole("heading", { name: "Challenge Arena", exact: true })).toBeVisible();
  await page.getByLabel("Choose a challenge").selectOption("dev-02");
  await page.getByRole("button", { name: "Run challenge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent-assisted", exact: true })).toBeVisible();
  await expect(page.getByText("numeric_mismatch: resolved", { exact: true })).toHaveCount(2);
  await expect(page.getByText("scripted execution", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Not eligible for an AI efficiency claim.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observable collaboration timeline" })).toBeVisible();
});

test("clean control and unavailable screening stay distinct", async ({ page }) => {
  await page.goto("/arena");
  await page.getByLabel("Choose a challenge").selectOption("dev-01");
  await page.getByRole("button", { name: "Run challenge", exact: true }).click();
  await expect(page.getByText("Clean: no hard-check challenges.", { exact: true })).toHaveCount(2);
  await page.getByLabel("Choose a challenge").selectOption("dev-04");
  await page.getByRole("button", { name: "Run challenge", exact: true }).click();
  await expect(page.getByText("unavailable: tool_failed", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Unresolved or partial", { exact: false })).toHaveCount(2);
});

test("saved results are labelled and mobile has no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/arena");
  await page.getByRole("button", { name: "Load labelled saved report" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("SAVED REPORT - not a live AI run.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Filter role").selectOption("critic");
  await expect(page.getByRole("heading", { name: "Observable collaboration timeline" })).toBeVisible();
  await page.keyboard.press("Tab");
});

test("disabled feature and capacity errors are explicit", async ({ page }) => {
  await page.route("**/api/arena/fixtures", route => route.fulfill({
    status: 404, json: { detail: "Challenge Arena is disabled. Set AML_ENABLE_ARENA=1 and restart." } }));
  await page.goto("/arena");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("disabled");
  await page.unroute("**/api/arena/fixtures");
  await page.reload();
  await page.route("**/api/arena/runs", route => route.fulfill({ status: 429, json: { detail: "Arena capacity reached." } }));
  await page.getByRole("button", { name: "Run challenge", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("capacity");
});

test("malformed stream falls back to validated polling", async ({ page }) => {
  await page.route("**/api/arena/runs/*/events", route => route.fulfill({
    status: 200, contentType: "text/event-stream", body: "event: arena\ndata: {\"wrong\":true}\n\n",
  }));
  await page.goto("/arena");
  await page.getByRole("button", { name: "Run challenge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent-assisted", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Polling fallback active.");
});
