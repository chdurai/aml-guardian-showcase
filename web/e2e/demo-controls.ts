import type { Page } from "@playwright/test";

// Demo pacing. DEMO_SPEED picks a preset; DEMO_SLOW_MO / DEMO_HOLD_MS override it.
const presets = {
  fast: { slowMo: 0, holdMs: 0 },
  normal: { slowMo: 400, holdMs: 2500 },
  slow: { slowMo: 900, holdMs: 5000 },
} as const;
type Speed = keyof typeof presets;
const requested = (process.env.DEMO_SPEED ?? "normal") as Speed;
const preset = presets[requested] ?? presets.normal;

export const demoSpeed = {
  name: requested in presets ? requested : "normal",
  slowMo: Number(process.env.DEMO_SLOW_MO ?? preset.slowMo),
  holdMs: Number(process.env.DEMO_HOLD_MS ?? preset.holdMs),
};

// Injected into every page of the demo only (not part of the application): a caption bar
// with a Pause/Resume button. Pause state lives in sessionStorage so it survives navigation.
function installOverlay() {
  const key = "aml-demo-paused";
  const render = () => {
    if (document.getElementById("aml-demo-bar")) return;
    const bar = document.createElement("div");
    bar.id = "aml-demo-bar";
    bar.setAttribute("style", "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:14px;max-width:min(920px,92vw);padding:12px 14px 12px 18px;background:#123c37;color:#fff;border-radius:14px;box-shadow:0 10px 30px #0004;font:500 14px/1.45 system-ui,sans-serif");
    const caption = document.createElement("span");
    caption.id = "aml-demo-caption";
    caption.style.flex = "1";
    caption.textContent = "Demo starting…";
    const button = document.createElement("button");
    button.id = "aml-demo-toggle";
    button.setAttribute("style", "flex-shrink:0;border:0;border-radius:9px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;background:#e7f3ef;color:#123c37");
    const sync = () => {
      const paused = sessionStorage.getItem(key) === "1";
      button.textContent = paused ? "▶ Resume" : "❚❚ Pause";
      bar.style.background = paused ? "#7a4a12" : "#123c37";
    };
    button.addEventListener("click", event => {
      event.stopPropagation();
      sessionStorage.setItem(key, sessionStorage.getItem(key) === "1" ? "0" : "1");
      sync();
    });
    sync();
    bar.append(caption, button);
    document.body.append(bar);
  };
  if (document.body) render();
  else document.addEventListener("DOMContentLoaded", render);
}

export async function startDemo(page: Page) {
  await page.addInitScript(installOverlay);
}

const isPaused = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("aml-demo-paused") === "1").catch(() => false);

/** Show a caption, then wait the configured hold time — and for as long as the viewer has paused. */
export async function narrate(page: Page, text: string) {
  await page.evaluate(([caption, speed]) => {
    const el = document.getElementById("aml-demo-caption");
    if (el) el.textContent = `${caption}  ·  speed: ${speed}`;
  }, [text, demoSpeed.name]);
  const until = Date.now() + demoSpeed.holdMs;
  while (Date.now() < until || await isPaused(page)) await page.waitForTimeout(150);
}

/** Hide the overlay while a screenshot is taken so report images show only the application. */
export async function withoutOverlay<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => { const bar = document.getElementById("aml-demo-bar"); if (bar) bar.style.visibility = "hidden"; });
  try { return await action(); }
  finally { await page.evaluate(() => { const bar = document.getElementById("aml-demo-bar"); if (bar) bar.style.visibility = "visible"; }); }
}
