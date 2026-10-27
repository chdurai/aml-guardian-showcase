import { caseSnapshot, expect, expected, noHorizontalScroll, openSeeded, openTab, meta, test, step } from "./support";
import { seededCaseId } from "../test-data";

test(...meta("first-visit"), async ({ page }) => {
  await step(page, "Open the workspace for the first time", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Every finding has a story/ })).toBeVisible();
    await expect(page.locator(".synthetic-label")).toHaveText("Synthetic environment");
    await expect(page.locator(".environment-note")).toContainText("Connected synthetic workspace");
  });
  await step(page, "Read \"How it works\": what the workspace does and does not do", async () => {
    await page.locator(".environment-note button").click();
    await expect(page.getByRole("dialog")).toContainText("One workspace. Clear boundaries.");
    await page.getByRole("button", { name: "Understood", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
  await step(page, "Open the beginner's guide in a new tab", async () => {
    const [guide] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("link", { name: "Start here: usage guide" }).click(),
    ]);
    await expect(guide.getByRole("heading", { level: 1 })).toContainText("No banking background needed");
    await guide.close();
  });
});

test(...meta("new-investigation"), async ({ page }) => {
  const want = expected("review");
  let before = 0;
  await step(page, "Choose a practice scenario: \"Needs a closer look\"", async () => {
    before = (await (await page.request.get("/api/cases")).json()).length;
    await page.goto("/");
    await page.getByRole("button", { name: "New investigation", exact: true }).click();
    await page.getByRole("radio", { name: new RegExp(`^${want.title}`) }).check();
  });
  await step(page, "Run the whole specialist team live", async () => {
    await page.getByRole("button", { name: "Run investigation", exact: true }).click();
    await expect(page.getByRole("heading", { name: want.account, exact: true })).toBeVisible();
    await expect(page.locator(".case-header .status")).toHaveText(want.statusLabel, { timeout: 300_000 });
  });
  await step(page, "The new case is in the queue with its findings filled in", async () => {
    await expect(page.locator(".nav-count")).toHaveText(String(before + 1));
    await expect(page.locator(".case-row.selected")).toContainText(want.account);
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await openTab(page, "Evidence");
    await expect(page.locator(".finding").first()).toBeVisible();
  });
});

test(...meta("find-cases"), async ({ page }) => {
  const search = page.getByRole("textbox", { name: "Search cases" });
  const filter = page.getByRole("combobox", { name: "Filter case lifecycle" });
  const rows = page.locator(".case-row");
  await step(page, "Search by account number", async () => {
    await page.goto("/");
    await search.fill(expected("screening").account);
    await expect(rows.first()).toBeVisible();
    for (const text of await rows.allInnerTexts()) expect(text).toContain(expected("screening").account);
  });
  await step(page, "Search by a party name", async () => {
    const party = (await caseSnapshot(page, seededCaseId("structuring"))).beneficiary as string;
    await search.fill(party.slice(0, 6));
    await expect(rows.filter({ hasText: party }).first()).toBeVisible();
  });
  await step(page, "Show only completed cases", async () => {
    await search.fill("");
    await filter.selectOption("completed");
    await expect(rows.first()).toBeVisible();
    for (const text of await rows.allInnerTexts()) expect(text).toContain("Workflow completed");
  });
  await step(page, "When nothing matches, the queue says so", async () => {
    await search.fill("no-such-account");
    await expect(page.getByText("No matching cases", { exact: true })).toBeVisible();
    await search.fill("");
    await filter.selectOption("all");
    await expect(rows.first()).toBeVisible();
  });
});

test(...meta("share-link"), async ({ page }) => {
  const id = seededCaseId("screening");
  await step(page, "Open a shared link that points straight at a case draft", async () => {
    await page.goto(`/?case=${id}&tab=draft`);
    await expect(page.getByRole("heading", { name: expected("screening").account, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
  });
  await step(page, "Reload — you stay exactly where you were", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
  });
  await step(page, "Move to Activity, then use the browser Back button", async () => {
    await openTab(page, "Activity");
    await expect(page).toHaveURL(/tab=activity/);
    await page.goBack();
    await expect(page).toHaveURL(/tab=draft/);
    await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
  });
});

test(...meta("phone"), async ({ page }) => {
  await step(page, "Switch to a 390-pixel phone screen and open a case", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSeeded(page, "structuring");
    expect(await noHorizontalScroll(page)).toBe(true);
  });
  for (const [next, heading] of [["Evidence", "Evidence ledger"], ["Case draft", "Case narrative"], ["Activity", "How the specialists worked together"]] as const) {
    await step(page, `Continue to ${next} — no sideways scrolling`, async () => {
      await page.getByRole("button", { name: `Continue to ${next}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});
