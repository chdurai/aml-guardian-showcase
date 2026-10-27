import { seedTestData } from "./test-data";

// Every browser run starts from the same known queue: one real run per fixed scenario.
export default async function globalSetup() {
  const cases = await seedTestData();
  process.env.AML_SEEDED_CASES = JSON.stringify(cases.map(c => ({ id: c.id, scenario: c.scenario })));
}
