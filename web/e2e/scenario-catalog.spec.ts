import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import catalog from "./scenarios/catalog.json";

// Keeps catalog.json, the scenario specs and the generated public/scenarios.html in step.
test("scenario catalog, specs and scenarios page agree", () => {
  const dir = join(__dirname, "scenarios");
  const registered = readdirSync(dir).filter(f => f.endsWith(".spec.ts"))
    .flatMap(f => [...readFileSync(join(dir, f), "utf8").matchAll(/^test\(\.\.\.meta\("([^"]+)"/gm)].map(m => m[1]));
  expect(registered.sort()).toEqual(catalog.scenarios.map(s => s.id).sort());
  for (const s of catalog.scenarios) expect(catalog.groups.map(g => g.id)).toContain(s.group);

  const page = readFileSync(join(__dirname, "../public/scenarios.html"), "utf8");
  for (const s of catalog.scenarios) expect(page, `regenerate with: npm run scenarios:page`).toContain(`run ${s.id} --watch`);
  expect(page).toContain(`${catalog.scenarios.length} scenarios. One command.`);
});
