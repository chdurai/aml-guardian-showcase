import { defineConfig } from "@playwright/test";
import { demoSpeed } from "./e2e/demo-controls";

const baseURL = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000";
const apiUrl = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
const python = process.env.PYTHON ?? ".venv/bin/python";
const apiPort = new URL(apiUrl).port || "8000";
const webPort = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "checks", testIgnore: [/demo\.spec\.ts/, /scenarios\//] },
    {
      // Catalogued user scenarios (e2e/scenarios/catalog.json). Run them with `npm run scenarios`.
      name: "scenarios",
      testDir: "./e2e/scenarios",
      timeout: demoSpeed.holdMs ? 0 : 120_000,
      use: { video: process.env.DEMO_VIDEO === "1" ? "on" : "off", launchOptions: { slowMo: demoSpeed.slowMo } },
    },
    {
      name: "demo",
      testMatch: /demo\.spec\.ts/,
      // No time limit: the viewer may pause indefinitely. Video needs `npx playwright install ffmpeg`.
      timeout: 0,
      use: { video: process.env.DEMO_VIDEO === "1" ? "on" : "off", launchOptions: { slowMo: demoSpeed.slowMo } },
    },
  ],
  // Reuses already-running services; otherwise starts both with test-data controls enabled.
  webServer: [
    {
      command: `${python} -m uvicorn aml_guardian.api:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: "..",
      url: `${apiUrl}/api/v1/cases`,
      env: { AML_ENABLE_TEST_DATA_CONTROLS: "1", AML_LLM_PROVIDER: process.env.AML_LLM_PROVIDER ?? "stub",
        AML_ENABLE_ARENA: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm run build && npm run start -- --port ${webPort}`,
      url: baseURL,
      env: { AML_API_URL: apiUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
