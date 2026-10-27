#!/usr/bin/env node
// Easy front door for the catalogued browser scenarios (e2e/scenarios/catalog.json).
//   node scripts/scenarios.mjs                 interactive menu
//   node scripts/scenarios.mjs list            list scenarios
//   node scripts/scenarios.mjs run <ids|groups|all> [--watch] [--speed slow|normal|fast] [--model] [--report]
//   node scripts/scenarios.mjs page            regenerate public/scenarios.html from the catalog
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(web, "e2e/scenarios/catalog.json"), "utf8"));
const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const apiUrl = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
const webUrl = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000";
const speeds = ["slow", "normal", "fast"];
const bold = s => process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
const dim = s => process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s;

const numbered = catalog.groups.flatMap(g => catalog.scenarios.filter(s => s.group === g.id));

function badges(s) {
  return [s.creates && "runs a new case", s.model && "best with local AI"].filter(Boolean).map(b => dim(`[${b}]`)).join(" ");
}

function list() {
  for (const group of catalog.groups) {
    console.log(`\n${bold(group.title)}  ${dim(`(group: ${group.id})`)}`);
    for (const s of numbered.filter(s => s.group === group.id))
      console.log(`  ${String(numbered.indexOf(s) + 1).padStart(2)}. ${s.id.padEnd(20)} ${s.title} ${badges(s)}`);
  }
  console.log();
}

function resolve(selectors) {
  const ids = new Set();
  for (const raw of selectors) {
    const sel = raw.trim().toLowerCase();
    if (!sel) continue;
    if (sel === "all") numbered.forEach(s => ids.add(s.id));
    else if (/^\d+$/.test(sel) && numbered[Number(sel) - 1]) ids.add(numbered[Number(sel) - 1].id);
    else if (catalog.groups.some(g => g.id === sel)) numbered.filter(s => s.group === sel).forEach(s => ids.add(s.id));
    else if (numbered.some(s => s.id === sel)) ids.add(sel);
    else throw new Error(`Unknown scenario or group "${raw}". Run with "list" to see the choices.`);
  }
  return numbered.filter(s => ids.has(s.id)).map(s => s.id);
}

async function probe(url) {
  try { return await (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(); } catch { return null; }
}

async function describeServices(model) {
  const runtime = await probe(`${apiUrl}/api/v1/runtime`);
  const webUp = await fetch(webUrl, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);
  if (runtime) {
    const ai = runtime.provider === "stub" ? "off (stub narration)" : `local model ${runtime.model}${runtime.reachable === false ? " — NOT reachable" : ""}`;
    console.log(`API: running at ${apiUrl} · AI drafting: ${ai}`);
    if (model && runtime.provider === "stub")
      console.log(dim("  --model has no effect: the running API was started without AML_LLM_PROVIDER=ollama. Restart it to use the local model."));
  } else {
    console.log(`API: not running — Playwright will start one (${model ? "local model via Ollama" : "stub mode; add --model for the local AI"}).`);
  }
  console.log(webUp ? `Web: running at ${webUrl}` : "Web: not running — Playwright will build and start it (about a minute).");
  if (runtime && runtime.provider !== "stub") console.log(dim("Note: with the local model, loading the four test cases takes about a minute before scenarios start."));
}

function run(ids, { watch, speed, model }) {
  const grep = `@(${ids.join("|")})(\\s|$)`;
  const args = [playwrightCli, "test", "--project=scenarios", "--grep", grep, "--reporter=list,html"];
  if (watch) args.push("--headed");
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    DEMO_SPEED: watch ? speed : "fast",
    ...(model ? { AML_LLM_PROVIDER: process.env.AML_LLM_PROVIDER ?? "ollama" } : {}),
  };
  console.log(`\nRunning ${ids.length} scenario(s)${watch ? ` in a visible browser at ${speed} speed — use the Pause button in the caption bar any time` : " in the background (headless)"}…\n`);
  return new Promise(done => spawn(process.execPath, args, { cwd: web, env, stdio: "inherit" }).on("exit", code => done(code ?? 1)));
}

const showReport = () => new Promise(done =>
  spawn(process.execPath, [playwrightCli, "show-report"], { cwd: web, stdio: "inherit" }).on("exit", done));

async function finish(code, openReport) {
  console.log(`\n${code === 0 ? "✅ All selected scenarios passed." : "❌ Some scenarios failed — the report shows the screenshots and a step-by-step trace."}`);
  console.log(`Report: ${join(web, "playwright-report/index.html")}  ${dim("(open it with: npm run e2e:report)")}`);
  if (openReport) { console.log(dim("Press Ctrl+C to close the report server.")); await showReport(); }
  process.exit(code);
}

async function menu() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(bold("\nAML Guardian · browser scenarios"));
  console.log(dim("Each scenario drives a real browser through the workspace using four synthetic test cases."));
  list();
  let ids = [];
  while (!ids.length) {
    const answer = await rl.question(`Which scenarios? ${dim("numbers, ids or a group — e.g. \"1 6 8\", \"stories\", \"all\" — q to quit")}: `);
    if (["q", "quit", "exit"].includes(answer.trim().toLowerCase())) { rl.close(); return; }
    try { ids = resolve(answer.split(/[\s,]+/)); } catch (error) { console.log(error.message); }
  }
  const watch = !/^n/i.test(await rl.question(`Watch in a browser window with captions? ${dim("[Y/n]")}: `));
  let speed = "normal";
  if (watch) {
    const pick = (await rl.question(`Speed — 1 slow, 2 normal, 3 fast ${dim("[2]")}: `)).trim();
    speed = speeds[Number(pick) - 1] ?? (speeds.includes(pick) ? pick : "normal");
  }
  const openReport = !/^n/i.test(await rl.question(`Open the visual report afterwards? ${dim("[Y/n]")}: `));
  rl.close();
  await describeServices(false);
  await finish(await run(ids, { watch, speed, model: false }), openReport);
}

const escape = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page() {
  const cards = catalog.groups.map(g => `<section id="${g.id}"><h2>${escape(g.title)}</h2><p>${escape(g.summary)} Run this group with <code>./scenarios.sh run ${g.id} --watch</code></p><div class="grid">${
    numbered.filter(s => s.group === g.id).map(s => `<article class="card"><h3><span class="number">${numbered.indexOf(s) + 1}</span>${escape(s.title)}</h3><p>${escape(s.story)}</p><ul>${s.checks.map(c => `<li>${escape(c)}</li>`).join("")}</ul><p class="run"><code>./scenarios.sh run ${s.id} --watch</code>${s.creates ? ' <span class="tag">runs a new case</span>' : ""}${s.model ? ' <span class="tag">best with local AI</span>' : ""}</p></article>`).join("")}</div></section>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Catalogue of AML Guardian browser automation scenarios and how to run them.">
<title>AML Guardian | Browser scenarios</title>
<!-- Generated by web/scripts/scenarios.mjs page from e2e/scenarios/catalog.json. Do not edit by hand. -->
<style>
:root{color-scheme:light;--ink:#233d36;--muted:#506b61;--line:#d6e4da}
*{box-sizing:border-box}body{margin:0;background:#f2f6f3;color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:#165f49}header{background:#173e32;color:#fff;padding:44px max(24px,calc((100% - 1050px)/2)) 34px}
.eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:12px;font-weight:700;color:#b5dfc6}
h1{font-size:clamp(28px,5vw,44px);line-height:1.2;margin:14px 0}header p{max-width:760px;color:#deeee3}.cta{display:inline-block;margin:6px 10px 0 0;padding:10px 16px;border-radius:7px;background:#e7f6e9;color:#143e2a;font-weight:650;text-decoration:none}.cta.ghost{background:transparent;color:#e7f6e9;border:1px solid #8fbfa5}
main{max-width:1100px;margin:24px auto;padding:0 24px}section{background:#fff;padding:26px 30px;border:1px solid var(--line);border-radius:12px;margin-top:22px}
h2{font-size:24px;margin:0 0 10px}h3{font-size:17px;margin:0 0 6px;display:flex;gap:10px;align-items:center}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}.card{border:1px solid var(--line);padding:18px;border-radius:9px;background:#fbfdfb}.card p,.card li{font-size:14px}.card ul{padding-left:20px;margin:8px 0}
.number{display:inline-grid;place-items:center;width:28px;height:28px;flex-shrink:0;border-radius:50%;background:#e6f2e8;color:#245d39;font-size:14px}
code{background:#edf3ee;padding:2px 6px;border-radius:4px;font-size:.9em;overflow-wrap:anywhere}pre{background:#10261f;color:#e3f1e8;padding:16px 18px;border-radius:9px;overflow-x:auto;font-size:14px;line-height:1.6}
.tag{display:inline-block;font-size:12px;border:1px solid #c9b07a;color:#6b5418;border-radius:12px;padding:0 8px;margin-left:4px}
.note{padding:14px 18px;border-left:4px solid #a47623;background:#fff8e9;color:#604917;border-radius:0 7px 7px 0;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}th{background:#edf5ef}
@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:0 12px}section{padding:22px 18px}}
</style>
</head>
<body>
<header>
<div class="eyebrow">AML Guardian / Browser automation</div>
<h1>${numbered.length} scenarios. One command.</h1>
<p>Each scenario opens a real browser and works through the investigation workspace like a person would. It loads four synthetic test cases first and checks what you should see at every step. Watch at your own pace with captions and a Pause button, or run them all in the background.</p>
<p><a class="cta" href="http://127.0.0.1:3000/" target="_blank" rel="noopener noreferrer">Open the application ↗</a> <a class="cta ghost" href="usage-guide.html">Beginner's guide</a></p>
</header>
<main>
<section id="run">
<h2>How to run</h2>
<p>From the project folder in Terminal:</p>
<pre>./scenarios.sh                                # menu: pick scenarios, watch or not, speed
./scenarios.sh list                           # list every scenario
./scenarios.sh run all                        # run everything in the background (about 1–2 minutes)
./scenarios.sh run sanctions-hold --watch     # watch one scenario with captions
./scenarios.sh run stories --watch --speed slow
./scenarios.sh run ai-draft-verifier --model  # use the local AI if Playwright starts the API</pre>
<table><thead><tr><th>Option</th><th>What it does</th></tr></thead><tbody>
<tr><td><code>--watch</code></td><td>Shows the browser with a caption bar describing each step. Click <strong>Pause</strong> or <strong>Resume</strong> at any time.</td></tr>
<tr><td><code>--speed slow|normal|fast</code></td><td>How long each caption stays on screen while watching. The default is <code>normal</code>.</td></tr>
<tr><td><code>--model</code></td><td>If the API is not already running, Playwright starts it with the local Ollama model so drafts are written by the AI.</td></tr>
<tr><td><code>--report</code></td><td>Opens the visual report afterwards. It has a screenshot of every step and a trace of any failure.</td></tr>
</tbody></table>
<div class="note">Running scenarios <strong>replaces the cases in your local queue</strong> with the four synthetic test cases. Nothing real is touched and nothing is filed. If the app is already running, it is reused; if not, it is started for you. Inside <code>web/</code>, <code>npm run scenarios</code> does the same as <code>./scenarios.sh</code>.</div>
</section>
${cards}
</main>
</body>
</html>
`;
  writeFileSync(join(web, "public/scenarios.html"), html);
  console.log("Wrote public/scenarios.html");
}

async function main(argv) {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter(a => a.startsWith("--")));
  const speedAt = rest.indexOf("--speed");
  const speed = speedAt >= 0 ? rest[speedAt + 1] : "normal";
  const selectors = rest.filter((a, i) => !a.startsWith("--") && !(speedAt >= 0 && i === speedAt + 1));
  if (!command) return process.stdin.isTTY ? menu() : list();
  if (command === "list") return list();
  if (command === "page") return page();
  if (command === "run") {
    if (!speeds.includes(speed)) throw new Error(`--speed must be one of ${speeds.join(", ")}`);
    const ids = resolve(selectors.length ? selectors : ["all"]);
    await describeServices(flags.has("--model"));
    return finish(await run(ids, { watch: flags.has("--watch"), speed, model: flags.has("--model") }), flags.has("--report"));
  }
  throw new Error(`Unknown command "${command}". Use: list | run <ids|groups|all> [--watch] [--speed slow|normal|fast] [--model] [--report] | page`);
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
