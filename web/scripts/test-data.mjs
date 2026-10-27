#!/usr/bin/env node
// Loads the fixed synthetic scenarios into a local API started with
// AML_ENABLE_TEST_DATA_CONTROLS=1. Talks to the API directly, never via the browser proxy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const apiUrl = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
export const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/synthetic-scenarios.json", import.meta.url), "utf8"));
const known = fixture.scenarios.map(s => s.scenario);

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(`${apiUrl}/api/v1/test-data${path}`, {
      method, headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(900_000),
    });
  } catch {
    throw new Error(`Cannot reach the AML Guardian API at ${apiUrl}. Start it first (see web/README.md).`);
  }
  if (response.status === 404)
    throw new Error("Test-data controls are disabled. Restart the API with AML_ENABLE_TEST_DATA_CONTROLS=1.");
  if (!response.ok) throw new Error(`Test-data request failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export const resetTestData = () => call("DELETE", "/cases");
export const seedTestData = (scenarios = known, reset = true) => call("POST", "/seed", { scenarios, reset });

async function main([command = "seed", ...args]) {
  const append = args.includes("--append");
  const scenarios = args.filter(a => !a.startsWith("--"));
  const unknown = scenarios.filter(s => !known.includes(s));
  if (!["seed", "reset"].includes(command) || unknown.length) {
    console.error(`Usage: node scripts/test-data.mjs seed [--append] [${known.join("|")} ...]\n       node scripts/test-data.mjs reset`);
    process.exit(2);
  }
  if (command === "reset") {
    const { removed } = await resetTestData();
    console.log(`Removed ${removed} synthetic case(s).`);
    return;
  }
  const cases = await seedTestData(scenarios.length ? scenarios : known, !append);
  console.log(`${append ? "Added" : "Loaded"} ${cases.length} synthetic case(s) by running the real workflow:`);
  for (const c of cases)
    console.log(`  ${c.account.padEnd(9)} ${c.scenario.padEnd(12)} score ${String(c.score).padStart(3)}  ${c.recommendation.padEnd(8)} ${c.status}`);
  console.log("Open http://127.0.0.1:3000 to explore them.");
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
