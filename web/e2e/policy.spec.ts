import { expect, test } from "@playwright/test";

test("policy proxy validates origin, shape, general references and abstention", async ({ request }) => {
  test.setTimeout(180_000);
  const origin = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000";
  const headers = { Origin: origin };
  expect((await request.post("/api/policy", {
    headers: { Origin: "https://other.example" }, data: { question: "Explain sanctions" },
  })).status()).toBe(403);
  for (const data of [{ question: " " }, { question: "Explain sanctions", account: "real" },
    { question: "x".repeat(401) }])
    expect((await request.post("/api/policy", { headers, data })).status()).toBe(422);
  expect((await request.post("/api/policy", {
    headers, data: { question: "Explain screening", case_id: "missing" },
  })).status()).toBe(404);
  const response = await request.post("/api/policy", {
    headers, data: { question: "Does a wire above $10,000 require a CTR?" }, timeout: 150_000,
  });
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer.case_context).toBeNull();
  expect(answer.passages.some((p: { id: string }) => p.id === "GUIDE-CTR")).toBe(true);
  expect(answer.passages.every((p: { id: string; text: string }) =>
    answer.retrieved.some((r: { id: string; text: string }) => r.id === p.id && r.text === p.text))).toBe(true);
  const unrelated = await request.post("/api/policy", { headers, data: { question: "What is the weather in Paris?" } });
  expect((await unrelated.json()).mode).toBe("abstained");
});
