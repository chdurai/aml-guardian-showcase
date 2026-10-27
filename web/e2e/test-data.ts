import fixture from "../../tests/fixtures/synthetic-scenarios.json";

export type ScenarioExpectation = {
  scenario: "structuring" | "routine" | "screening" | "review";
  title: string;
  account: string;
  score: number;
  recommendation: "CLEAR" | "REVIEW" | "FILE_SAR" | "HOLD";
  recommendationLabel: string;
  status: "awaiting_human" | "completed";
  statusLabel: string;
  incoming: number;
  outgoing: number;
  route: string[];
};

// Same golden file as tests/test_test_data.py and scripts/test-data.mjs.
export const expectations = fixture.scenarios as ScenarioExpectation[];
const apiUrl = process.env.AML_API_URL ?? "http://127.0.0.1:8000";

export async function seedTestData(): Promise<{ id: string; scenario: string }[]> {
  const response = await fetch(`${apiUrl}/api/v1/test-data/seed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarios: expectations.map(e => e.scenario), reset: true }),
    signal: AbortSignal.timeout(900_000),
  }).catch(() => { throw new Error(`Cannot reach the AML Guardian API at ${apiUrl}.`); });
  if (response.status === 404)
    throw new Error("Test-data controls are disabled. Restart the API with AML_ENABLE_TEST_DATA_CONTROLS=1 (see web/README.md).");
  if (!response.ok) throw new Error(`Seeding failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export function seededCaseId(scenario: ScenarioExpectation["scenario"]): string {
  const seeded: { id: string; scenario: string }[] = JSON.parse(process.env.AML_SEEDED_CASES ?? "[]");
  const match = seeded.find(c => c.scenario === scenario);
  if (!match) throw new Error(`No seeded ${scenario} case. Run through Playwright so global setup loads test data.`);
  return match.id;
}

export const money = (value: number) => `$${value.toLocaleString("en-US")}`;
