import { expect, openSeeded, openTab, meta, test, step } from "./support";

const fileControl = /file (a |the )?(sar|report)|send to (the )?regulator/i;

test(...meta("safety-limits"), async ({ page }) => {
  await step(page, "Open a high-risk case awaiting a human", async () => {
    await openSeeded(page, "structuring");
    await expect(page.getByRole("region", { name: "Result explained" })).toContainText("Next step is yours");
  });
  await step(page, "No step offers a button that files a report", async () => {
    for (const tab of ["Overview", "Evidence", "Case draft", "Activity"] as const) {
      await openTab(page, tab);
      await expect(page.getByRole("button", { name: fileControl })).toHaveCount(0);
    }
  });
  await step(page, "Submit stays disabled until action, name, reason and checklist are complete", async () => {
    const panel = page.getByRole("region", { name: "Record your decision" });
    await expect(panel.getByRole("button", { name: /^Submit/ })).toBeDisabled();
    await expect(panel).toContainText("To continue: choose an action, enter your name");
    await expect(panel).toContainText("Simulated only: nothing is filed");
  });
  await step(page, "The draft says decisions stay with a human", async () => {
    await openTab(page, "Case draft");
    await expect(page.getByText("Your decision is recorded in the decision panel, not here")).toBeVisible();
  });
  await step(page, "The browser cannot send customer data or commands from another site", async () => {
    const origin = new URL(page.url()).origin;
    const crossSite = await page.request.post("/api/cases", { headers: { Origin: "https://other.example" }, data: { scenario: "routine" } });
    expect(crossSite.status()).toBe(403);
    const customer = await page.request.post("/api/cases", { headers: { Origin: origin }, data: { scenario: "routine", account: "real-customer" } });
    expect(customer.status()).toBe(422);
    const id = new URL(page.url()).searchParams.get("case");
    const incomplete = await page.request.post(`/api/cases/${id}/decision`, { headers: { Origin: origin }, data: { action: "APPROVE_SAR", reviewer: "Ana", rationale: "ok", evidence_reviewed: false } });
    expect(incomplete.status()).toBe(422);
  });
});

test(...meta("connection-problems"), async ({ page }) => {
  await step(page, "Open a link to a case that no longer exists", async () => {
    await page.goto("/?case=00000000-0000-4000-8000-000000000000&tab=overview");
    await expect(page.getByRole("heading", { name: "Case unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic case not found" })).toBeVisible();
  });
  await step(page, "Open a real case, then lose the connection to the analysis service", async () => {
    await openSeeded(page, "structuring");
    await page.route(/\/api\/cases(\/|\?|$)/, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Analysis service unreachable (simulated)." }) }));
    await page.getByRole("button", { name: "Refresh cases" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Last snapshot may be out of date" })).toBeVisible();
    await expect(page.getByText("Connection lost · stale snapshot")).toBeVisible();
  });
  await step(page, "The service is back — Retry recovers", async () => {
    await page.unroute(/\/api\/cases(\/|\?|$)/);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Last snapshot may be out of date" })).toBeHidden();
    await expect(page.getByText("Connection lost · stale snapshot")).toBeHidden();
  });
});

test(...meta("human-decision"), async ({ page }) => {
  await step(page, "A screening HOLD case arrives and the queue says a decision is needed", async () => {
    await page.goto("/");
    const origin = new URL(page.url()).origin;
    const created = await (await page.request.post("/api/cases", { headers: { Origin: origin }, data: { scenario: "screening" } })).json();
    await page.goto(`/?case=${created.id}&tab=overview`);
    await expect(page.locator(".case-header .status")).toHaveText("Needs your decision", { timeout: 180_000 });
    await expect(page.locator(".case-row.selected .action-chip")).toContainText("Action needed");
  });
  const panel = page.getByRole("region", { name: "Record your decision" });
  await step(page, "The banner explains what to do; Go to decision opens the panel", async () => {
    await expect(page.getByRole("region", { name: "Your action is needed" })).toContainText("Level 1 · Analyst review");
    await page.getByRole("button", { name: "Go to decision" }).click();
    await expect(panel).toBeInViewport();
  });
  await step(page, "Closing a HOLD is blocked at level 1, with the reason shown", async () => {
    await expect(panel.getByRole("radio", { name: /Close with no further action/ })).toBeDisabled();
    await expect(panel).toContainText("A screening HOLD must be resolved by a senior reviewer");
  });
  await step(page, "The analyst escalates with a name, a reason and the checklist", async () => {
    await panel.getByRole("radio", { name: /Escalate to a senior reviewer/ }).check();
    await panel.getByLabel(/Your name/).fill("Ana Analyst");
    await panel.getByLabel(/rationale/).fill("Beneficiary matched the example list; a senior must resolve the hold.");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Submit: Escalate to a senior reviewer" }).click();
    await expect(page.getByRole("region", { name: "Your action is needed" })).toContainText("Level 2 · Senior four-eyes review", { timeout: 60_000 });
    await expect(panel).toContainText("Escalated by Ana Analyst");
  });
  await step(page, "The same person cannot finish their own escalation", async () => {
    await panel.getByRole("radio", { name: /Close with no further action/ }).check();
    await panel.getByLabel(/Your name/).fill("ana analyst");
    await panel.getByLabel(/rationale/).fill("Checked the synthetic name; it is a test fixture, not a real party.");
    await panel.getByRole("checkbox").check();
    await expect(panel.getByRole("button", { name: /^Submit/ })).toBeDisabled();
    await expect(panel).toContainText("use a different senior reviewer");
  });
  await step(page, "A different senior reviewer closes it; the history names both people", async () => {
    await panel.getByLabel(/Your name/).fill("Sam Senior");
    await panel.getByRole("button", { name: /^Submit/ }).click();
    const done = page.getByRole("region", { name: "Human decision" });
    await expect(done).toContainText("Human decision recorded", { timeout: 60_000 });
    await expect(page.locator(".case-header .status")).toHaveText("Workflow completed");
    await expect(done).toContainText("Ana Analyst");
    await expect(done).toContainText("Closed with no further action by Sam Senior");
  });
});
