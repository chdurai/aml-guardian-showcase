import AxeBuilder from "@axe-core/playwright";
import { caseSnapshot, expect, meta, noHorizontalScroll, openSeeded, step, test } from "./support";

test(...meta("policy-references"), async ({ page }) => {
  test.setTimeout(300_000);
  const id = await openSeeded(page, "screening");
  const before = await caseSnapshot(page, id);
  const dialog = page.getByRole("dialog", { name: /Policy reference assistant/ });
  await step(page, "Ask for guidance related to the selected screening case", async () => {
    await page.getByRole("button", { name: "Policy assistant", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Find references" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Try: What guidance relates to this case?" }).click();
    await dialog.getByRole("button", { name: "Find references" }).click();
    await expect(dialog.locator(".policy-result")).toBeVisible({ timeout: 150_000 });
    await expect(dialog.locator(".policy-snapshot")).toContainText("Rule score 100/100");
    await expect(dialog.locator(".policy-passage").first()).toContainText("GUIDE-SCREENING");
  });
  await step(page, "Inspect exact extracts, source links and the actual retrieval pipeline", async () => {
    await expect(dialog.locator(".policy-passage blockquote").first()).toContainText("not a confirmed identity match");
    await expect(dialog.getByRole("link", { name: "Read background guidance" }).first()).toHaveAttribute("href", "https://ofac.treasury.gov/faqs/5");
    await dialog.getByText("How this answer was assembled", { exact: true }).click();
    await expect(dialog.locator("details")).toContainText("LangChain lexical retriever");
    await expect(dialog.locator("details")).toContainText("case state unchanged");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await noHorizontalScroll(page)).toBe(true);
      const box = await dialog.locator(".policy-result").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThan(width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  });
  await step(page, "An unrelated question produces an honest no-answer result, not invented guidance", async () => {
    await dialog.getByLabel("Your policy-reference question").fill("What is the weather in Paris?");
    await dialog.getByRole("button", { name: "Find references" }).click();
    await expect(dialog.getByRole("heading", { name: "No supported answer" })).toBeVisible();
    await expect(dialog.locator(".policy-passage")).toHaveCount(0);
    expect(await caseSnapshot(page, id)).toEqual(before);
  });
  await step(page, "Errors remain visible and never look like successful answers", async () => {
    await dialog.getByLabel("Include selected synthetic case: ACC-9999").uncheck();
    await page.route("**/api/policy", route => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Assistant disconnected for test." }),
    }));
    await dialog.getByLabel("Your policy-reference question").fill("Explain sanctions screening");
    await dialog.getByRole("button", { name: "Find references" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Assistant disconnected for test." })).toBeVisible();
    await expect(dialog.locator(".policy-result")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  });
});
