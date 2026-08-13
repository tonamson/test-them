import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateExpects } from "./ui-expect.mjs";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright not installed. npm install playwright && npx playwright install chromium");
  }
}

async function shotData(page) {
  const buf = await page.screenshot({ fullPage: true, type: "png" });
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function snapshot(page, selectors = []) {
  const text = await page.locator("body").innerText();
  const visible = [];
  const hidden = [];
  for (const selector of selectors) {
    const loc = page.locator(selector);
    const count = await loc.count();
    if (!count) {
      hidden.push(selector);
      continue;
    }
    if (await loc.first().isVisible()) visible.push(selector);
    else hidden.push(selector);
  }
  return {
    url: page.url(),
    title: await page.title(),
    text,
    visible,
    hidden,
    consoleErrors: page.__consoleErrors || [],
  };
}

function selectorsFrom(steps, expects) {
  const out = new Set();
  for (const exp of expects || []) {
    if (exp.selector) out.add(exp.selector);
  }
  for (const step of steps || []) {
    if (step.selector) out.add(step.selector);
    for (const exp of step.expects || []) {
      if (exp.selector) out.add(exp.selector);
    }
  }
  return [...out];
}

function expectedText(expects = []) {
  if (!expects.length) return "UI steps complete with no Playwright error.";
  return expects.map((e) => {
    if (e.kind === "seeText") return `see "${e.text}"`;
    if (e.kind === "noText") return `do not see "${e.text}"`;
    if (e.kind === "urlIncludes") return `url includes "${e.text}"`;
    if (e.kind === "titleIncludes") return `title includes "${e.text}"`;
    if (e.kind === "visible") return `visible ${e.selector}`;
    if (e.kind === "hidden") return `hidden ${e.selector}`;
    if (e.kind === "noConsoleError") return "no console errors";
    return e.kind;
  }).join("; ");
}

async function runOneViewport(browser, input, name) {
  const size = VIEWPORTS[name] || VIEWPORTS.desktop;
  const page = await browser.newPage({ viewport: size });
  page.__consoleErrors = [];
  page.on("pageerror", (err) => page.__consoleErrors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") page.__consoleErrors.push(msg.text());
  });

  const steps = input.steps || [];
  const expects = input.expects || [];
  const screenshots = [];
  let lastError;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  try {
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    screenshots.push({ step: "open", src: await shotData(page) });

    for (const [index, step] of steps.entries()) {
      const action = step.action;
      if (action === "fill") await page.fill(step.selector, String(step.value ?? ""));
      else if (action === "click") await page.click(step.selector);
      else if (action === "wait" && step.urlIncludes) {
        await page.waitForURL((href) => href.includes(step.urlIncludes), { timeout: 15000 });
      } else if (action === "wait" && step.selector) {
        await page.waitForSelector(step.selector, { timeout: 15000 });
      } else if (action === "expect") {
        // no interaction; snapshot later
      } else {
        throw new Error(`unknown ui step ${action}`);
      }
      screenshots.push({ step: action, src: await shotData(page) });
    }
  } catch (err) {
    lastError = err.message;
  }

  const snap = lastError
    ? { url: input.url, title: "", text: "", visible: [], hidden: [], consoleErrors: page.__consoleErrors }
    : await snapshot(page, selectorsFrom(steps, expects));
  snap.consoleErrors = page.__consoleErrors;
  await page.close();

  const judged = evaluateExpects(snap, expects);
  const consoleWarn = !expects.some((e) => e.kind === "noConsoleError") && snap.consoleErrors.length > 0;
  let verdict = "pass";
  let reason = "UI steps completed";
  if (lastError) {
    verdict = "fail";
    reason = lastError;
  } else if (judged.misses.length) {
    verdict = "fail";
    reason = judged.unexpected.text;
  } else if (consoleWarn) {
    verdict = "warn";
    reason = `console: ${snap.consoleErrors[0]}`;
  }

  return {
    id: `ui-${name}`,
    family: "ui",
    title: lastError ? `UI failed (${name})` : `UI flow (${name})`,
    scenario: `Live ${name} page ${input.url}`,
    purpose: "Verify the live page matches written UI expects.",
    expectedText: expectedText(expects),
    unexpected: lastError ? { kind: "playwright", text: lastError } : judged.unexpected,
    live: true,
    startedAt,
    elapsedMs: Math.round(performance.now() - t0),
    request: { method: "GET", url: input.url, headers: {}, body: { steps, expects, viewport: name } },
    response: {
      status: lastError ? 0 : 200,
      headers: {},
      error: lastError,
      body: { url: snap.url, title: snap.title, consoleErrors: snap.consoleErrors },
    },
    verdict,
    reason,
    screenshots,
    uiExpects: { hits: judged.hits, misses: judged.misses },
  };
}

export async function uiProbe(input = {}) {
  if (!input.url) throw new Error("ui_probe needs url");
  const { chromium } = await loadPlaywright();
  const names = (input.viewports && input.viewports.length) ? input.viewports : ["desktop"];
  const browser = await chromium.launch({ headless: true });
  try {
    const cases = [];
    for (const name of names) {
      cases.push(await runOneViewport(browser, input, name));
    }
    return cases;
  } finally {
    await browser.close();
  }
}

export { getByPath };

function getByPath(obj, dotted) {
  return dotted.split(".").reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}
