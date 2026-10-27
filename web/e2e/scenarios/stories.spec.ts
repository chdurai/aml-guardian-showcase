import { caseSnapshot, expect, expected, openSeeded, openTab, meta, test, step } from "./support";
import { money } from "../test-data";
import { assertRecordedRoute } from "../route-expectations";

test(...meta("transfer-pattern"), async ({ page }) => {
  const want = expected("structuring");
  let id = "";
  await step(page, `Open ${want.account} from the case queue`, async () => {
    id = await openSeeded(page, "structuring");
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await expect(page.locator(".case-header .status")).toHaveText(want.statusLabel);
  });
  await step(page, `Rule-based score ${want.score}/100 — expand the rule-by-rule breakdown`, async () => {
    await expect(page.locator(".metric-card").first().locator("strong")).toHaveText(`${want.score}/100`);
    await page.getByText("Why this score? See the rule breakdown", { exact: true }).click();
    await expect(page.locator(".score-explanation dd")).toHaveText(["+50", "+20", "+25", "+30", "+10"]);
  });
  await step(page, `Follow the money: ${money(want.incoming)} in, ${money(want.outgoing)} out`, async () => {
    await expect(page.locator(".money-flow > div").first().locator("strong")).toHaveText(money(want.incoming));
    await expect(page.locator(".money-flow > div").last().locator("strong")).toHaveText(money(want.outgoing));
    await expect(page.locator(".signal").first()).toBeVisible();
  });
  await step(page, "Evidence: every finding names the specialist that produced it — open one source", async () => {
    await openTab(page, "Evidence");
    await expect(page.getByRole("heading", { name: "Evidence ledger" })).toBeVisible();
    const findings = (await caseSnapshot(page, id)).findings;
    await expect(page.locator(".finding")).toHaveCount(findings.length);
    await page.locator(".citation-list button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
  await step(page, "Case draft: read-only, clearly not a filed report", async () => {
    await openTab(page, "Case draft");
    await expect(page.getByRole("heading", { name: "Case narrative" })).toBeVisible();
    await expect(page.locator(".draft-notice")).toContainText(/not a filed|not a live-model SAR/);
    await expect(page.getByText("Your decision is recorded in the decision panel, not here")).toBeVisible();
  });
  await step(page, "The workflow stops at the human checkpoint — nothing further happens automatically", async () => {
    await expect(page.getByRole("region", { name: "Result explained" })).toContainText("Next step is yours");
  });
});

test(...meta("routine-clear"), async ({ page }) => {
  const want = expected("routine");
  let id = "";
  await step(page, `Open ${want.account}: an ordinary payment`, async () => {
    id = await openSeeded(page, "routine");
    await expect(page.locator(".metric-card").first().locator("strong")).toHaveText(`${want.score}/100`);
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await expect(page.locator(".case-header .status")).toHaveText(want.statusLabel);
  });
  await step(page, "Case draft: fixed text, because low-risk cases close by rule", async () => {
    await openTab(page, "Case draft");
    await expect(page.locator(".section-heading .MuiChip-root")).toHaveText("Fixed rule output");
  });
  await step(page, "Activity: the evidence critic was skipped and the case closed automatically", async () => {
    await openTab(page, "Activity");
    const route = assertRecordedRoute(await caseSnapshot(page, id), want.route);
    await expect(page.locator(".agent-path li")).toHaveCount(route.length);
    await expect(page.locator(".agent-path")).not.toContainText("Evidence critic");
    await page.locator(".agent-path button").last().click();
    await expect(page.locator(".agent-detail")).toContainText("no human approval recorded");
    await expect(page.locator(".route-explanation")).toContainText("automatic closure");
  });
});

test(...meta("sanctions-hold"), async ({ page }) => {
  const want = expected("screening");
  await step(page, `Open ${want.account}: a name matched the screening list`, async () => {
    await openSeeded(page, "screening");
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await expect(page.locator(".case-header .status")).toHaveText(want.statusLabel);
  });
  await step(page, "The screening check is labelled illustrative — not a live sanctions service", async () => {
    await expect(page.locator(".method-note")).toContainText("Illustrative two-name substring check");
    await openTab(page, "Evidence");
    await page.getByRole("button", { name: "Screening method", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("not a sanctions/PEP service");
    await page.keyboard.press("Escape");
  });
  await step(page, "Suspicious names appear as plain text everywhere, never as hidden markers", async () => {
    for (const tab of ["Overview", "Evidence", "Case draft"] as const) {
      await openTab(page, tab);
      const facts = page.locator(".facts-toggle");
      if (await facts.count()) await facts.click();
      await expect(page.locator("main")).not.toContainText(/<<<|UNTRUSTED/);
    }
  });
});

test(...meta("needs-review"), async ({ page }) => {
  const want = expected("review");
  await step(page, `Open ${want.account}: some signals, not enough for a report`, async () => {
    await openSeeded(page, "review");
    await expect(page.locator(".metric-card").first().locator("strong")).toHaveText(`${want.score}/100`);
    await expect(page.locator(".case-header .recommendation")).toHaveText(want.recommendationLabel);
    await expect(page.locator(".case-header .status")).toHaveText(want.statusLabel);
  });
  await step(page, "Signals worth a closer look are listed for the reviewer", async () => {
    await expect(page.locator(".signal").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Result explained" })).toContainText("closer human attention");
  });
});
