import { expect, test as base, type Page } from "@playwright/test";
import catalog from "./catalog.json";
import { narrate, startDemo, withoutOverlay } from "../demo-controls";
import { expectations, seededCaseId, type ScenarioExpectation } from "../test-data";

export { expect };
export type ScenarioEntry = (typeof catalog.scenarios)[number];
const entryFor = (tags: string[]) => catalog.scenarios.find(s => tags.includes(`@${s.id}`));

// Every scenario starts on a desktop viewport with the caption bar (Pause/Resume) installed.
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (entryFor(testInfo.tags)?.creates && testInfo.timeout) testInfo.setTimeout(Math.max(testInfo.timeout, 360_000));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await startDemo(page);
    await use(page);
  },
});

/** Title, tag and story for a catalogued scenario: `test(...meta("routine-clear"), async ({ page }) => …)`. */
export function meta(id: string) {
  const entry = catalog.scenarios.find(s => s.id === id);
  if (!entry) throw new Error(`Scenario "${id}" is not in e2e/scenarios/catalog.json`);
  return [entry.title, { tag: `@${id}`, annotation: { type: "Story", description: entry.story } }] as const;
}

/** One visible step: caption first (so a viewer knows what is coming), then the action, then a report screenshot. */
export async function step(page: Page, caption: string, action: () => Promise<void>) {
  await test.step(caption, async () => {
    if (page.url() !== "about:blank") await narrate(page, caption);
    await action();
    await snapshot(page, caption);
  });
}

export async function snapshot(page: Page, name: string) {
  const body = await withoutOverlay(page, () => page.screenshot()).catch(() => null);
  if (body) await test.info().attach(name, { body, contentType: "image/png" });
}

export const expected = (scenario: ScenarioExpectation["scenario"]) =>
  expectations.find(e => e.scenario === scenario)!;

/** Opens a case preloaded by global setup from the queue, as a user would. */
export async function openSeeded(page: Page, scenario: ScenarioExpectation["scenario"]) {
  const id = seededCaseId(scenario);
  await page.goto("/");
  await page.locator(`.case-row[href*="${id}"]`).click();
  await expect(page.getByRole("heading", { name: expected(scenario).account, exact: true })).toBeVisible();
  return id;
}

export async function openTab(page: Page, title: "Overview" | "Evidence" | "Case draft" | "Activity") {
  await page.locator(".case-tabs button").filter({ hasText: new RegExp(`^${title}`) }).click();
}

export async function caseSnapshot(page: Page, id: string) {
  return (await page.request.get(`/api/cases/${id}`)).json();
}

export const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
