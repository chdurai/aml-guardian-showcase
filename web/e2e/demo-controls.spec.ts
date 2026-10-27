import { expect, test } from "@playwright/test";
import { narrate, startDemo } from "./demo-controls";

test("demo overlay pauses narration until resumed, across navigation", async ({ page }) => {
  await startDemo(page);
  await page.goto("/usage-guide.html");
  const toggle = page.locator("#aml-demo-toggle");
  await expect(toggle).toHaveText("❚❚ Pause");
  await toggle.click();
  await expect(toggle).toHaveText("▶ Resume");
  await page.goto("/");
  await expect(page.locator("#aml-demo-toggle")).toHaveText("▶ Resume");

  let finished = false;
  const pending = narrate(page, "Paused caption").then(() => { finished = true; });
  await expect(page.locator("#aml-demo-caption")).toContainText("Paused caption");
  await page.waitForTimeout(800);
  expect(finished).toBe(false);
  await page.locator("#aml-demo-toggle").click();
  await pending;
  expect(finished).toBe(true);
});
