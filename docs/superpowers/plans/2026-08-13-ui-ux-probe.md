# UI/UX probe thickening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thicken `ui_probe` so a live page can fail on written expects, ship standalone screenshots in the HTML report, and stay optional-Playwright.

**Architecture:** Pure matcher in `ui-expect.mjs` (no browser). `ui.mjs` runs Playwright, collects page snapshot + console, calls the matcher, embeds PNGs as data URLs. MCP schema and report template consume the same case shape as API cases. Self-check uses a static fixture and skips UI if Playwright is missing.

**Tech Stack:** Node 18+, existing MCP + Zod, optional Playwright, `node:test` for matcher unit tests.

## Global Constraints

- Package id stays `test-them`. Brand copy stays `test them`.
- Playwright remains optional. Do not add it to `package.json` dependencies.
- No new required npm packages.
- English-only report copy. No em-dashes in user-visible strings.
- Live only. Do not mock HTTP or invent page results.
- Keep existing API `diagnose` / `render` behavior unchanged.
- `family: "ui"` already exists on the run schema enum.

## File map

| File | Role |
|------|------|
| Create `plugins/test-them/src/ui-expect.mjs` | Pure expect evaluation |
| Create `plugins/test-them/src/ui-expect.test.mjs` | Matcher unit tests |
| Create `plugins/test-them/fixtures/ui-page.html` | Self-check page |
| Modify `plugins/test-them/src/ui.mjs` | Runner + embed shots |
| Modify `plugins/test-them/src/server.mjs` | Zod schema for expects/viewports |
| Modify `plugins/test-them/templates/report.html` | Brief expects + data-URL shots |
| Modify `plugins/test-them/schemas/run.schema.json` | `screenshots`, `uiExpects` |
| Modify `plugins/test-them/skills/test-them/SKILL.md` | When/how to call `ui_probe` |
| Modify `plugins/test-them/src/self-check.mjs` | Fixture + optional Playwright |
| Modify `plugins/test-them/package.json` | Add `test` script |

---

### Task 1: Pure expect matcher

**Files:**
- Create: `plugins/test-them/src/ui-expect.mjs`
- Create: `plugins/test-them/src/ui-expect.test.mjs`
- Modify: `plugins/test-them/package.json`

**Interfaces:**
- Consumes: nothing from other new files
- Produces:
  - `evaluateExpects(snapshot, expects) -> { hits, misses, unexpected }`
  - `snapshot` = `{ url, title, text, visible: string[], hidden: string[], consoleErrors: string[] }`
  - `expects` = `Array<{ kind, text?, selector? }>`
  - `kind` one of `seeText` | `noText` | `urlIncludes` | `titleIncludes` | `visible` | `hidden` | `noConsoleError`

- [ ] **Step 1: Write the failing test**

Create `plugins/test-them/src/ui-expect.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExpects } from "./ui-expect.mjs";

const snap = {
  url: "http://127.0.0.1/login",
  title: "Sign in",
  text: "Welcome back Email Password",
  visible: ["#email", "button[type=submit]"],
  hidden: ["#toast-error"],
  consoleErrors: [],
};

test("seeText hits when page text contains needle", () => {
  const out = evaluateExpects(snap, [{ kind: "seeText", text: "Welcome back" }]);
  assert.equal(out.misses.length, 0);
  assert.equal(out.hits[0].kind, "seeText");
});

test("seeText misses when needle absent", () => {
  const out = evaluateExpects(snap, [{ kind: "seeText", text: "Dashboard" }]);
  assert.equal(out.misses.length, 1);
  assert.match(out.unexpected.text, /Dashboard/);
});

test("noText fails when needle is present", () => {
  const out = evaluateExpects(snap, [{ kind: "noText", text: "Welcome back" }]);
  assert.equal(out.misses.length, 1);
});

test("urlIncludes and titleIncludes", () => {
  const out = evaluateExpects(snap, [
    { kind: "urlIncludes", text: "/login" },
    { kind: "titleIncludes", text: "Sign" },
  ]);
  assert.equal(out.misses.length, 0);
});

test("visible and hidden selectors", () => {
  const out = evaluateExpects(snap, [
    { kind: "visible", selector: "#email" },
    { kind: "hidden", selector: "#toast-error" },
  ]);
  assert.equal(out.misses.length, 0);
});

test("noConsoleError fails when consoleErrors exist", () => {
  const dirty = { ...snap, consoleErrors: ["Uncaught TypeError"] };
  const out = evaluateExpects(dirty, [{ kind: "noConsoleError" }]);
  assert.equal(out.misses.length, 1);
});

test("empty expects is a clean hit list", () => {
  const out = evaluateExpects(snap, []);
  assert.equal(out.hits.length, 0);
  assert.equal(out.misses.length, 0);
  assert.equal(out.unexpected, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd plugins/test-them && node --test src/ui-expect.test.mjs
```

Expected: FAIL, `Cannot find module './ui-expect.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `plugins/test-them/src/ui-expect.mjs`:

```js
const KINDS = new Set([
  "seeText",
  "noText",
  "urlIncludes",
  "titleIncludes",
  "visible",
  "hidden",
  "noConsoleError",
]);

function hasText(hay, needle) {
  return String(hay || "").includes(String(needle || ""));
}

function checkOne(snapshot, exp) {
  const kind = exp?.kind;
  if (!KINDS.has(kind)) {
    return { ok: false, kind, detail: `unknown expect ${kind}` };
  }
  if (kind === "seeText") {
    const ok = hasText(snapshot.text, exp.text);
    return { ok, kind, detail: ok ? `saw "${exp.text}"` : `missing text "${exp.text}"` };
  }
  if (kind === "noText") {
    const present = hasText(snapshot.text, exp.text);
    return { ok: !present, kind, detail: present ? `saw forbidden "${exp.text}"` : `no "${exp.text}"` };
  }
  if (kind === "urlIncludes") {
    const ok = hasText(snapshot.url, exp.text);
    return { ok, kind, detail: ok ? `url has "${exp.text}"` : `url missing "${exp.text}"` };
  }
  if (kind === "titleIncludes") {
    const ok = hasText(snapshot.title, exp.text);
    return { ok, kind, detail: ok ? `title has "${exp.text}"` : `title missing "${exp.text}"` };
  }
  if (kind === "visible") {
    const ok = (snapshot.visible || []).includes(exp.selector);
    return { ok, kind, detail: ok ? `visible ${exp.selector}` : `not visible ${exp.selector}` };
  }
  if (kind === "hidden") {
    const listed = (snapshot.hidden || []).includes(exp.selector);
    const alsoVisible = (snapshot.visible || []).includes(exp.selector);
    const ok = listed || !alsoVisible;
    return { ok, kind, detail: ok ? `hidden ${exp.selector}` : `still visible ${exp.selector}` };
  }
  const errors = snapshot.consoleErrors || [];
  const ok = errors.length === 0;
  return { ok, kind, detail: ok ? "no console errors" : `console: ${errors[0]}` };
}

export function evaluateExpects(snapshot, expects = []) {
  const hits = [];
  const misses = [];
  for (const exp of expects) {
    const row = checkOne(snapshot, exp);
    (row.ok ? hits : misses).push(row);
  }
  const unexpected = misses.length
    ? { kind: "expect", text: misses.map((m) => m.detail).join("; ") }
    : null;
  return { hits, misses, unexpected };
}
```

Add to `plugins/test-them/package.json` scripts:

```json
"test": "node --test src/ui-expect.test.mjs",
"check": "node --test src/ui-expect.test.mjs && node src/self-check.mjs"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd plugins/test-them && node --test src/ui-expect.test.mjs
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/test-them/src/ui-expect.mjs plugins/test-them/src/ui-expect.test.mjs plugins/test-them/package.json
git commit -m "feat: add ui expect matcher"
```

---

### Task 2: Playwright runner uses expects, viewports, embedded shots

**Files:**
- Modify: `plugins/test-them/src/ui.mjs`
- Create: `plugins/test-them/fixtures/ui-page.html`

**Interfaces:**
- Consumes: `evaluateExpects(snapshot, expects)` from `./ui-expect.mjs`
- Produces: `uiProbe({ url, steps, expects, viewports, outDir }) -> Promise<UiCase[]>`
  - Always returns an **array** of cases (one per viewport)
  - Each case: `id` `ui-desktop` or `ui-mobile`, `family: "ui"`, `scenario`, `purpose`, `expectedText`, `unexpected`, `screenshots: [{ step, src }]`, `consoleErrors`, `uiExpects: { hits, misses }`
  - `src` is `data:image/png;base64,...`

Viewport map (lock these numbers):

```js
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
```

- [ ] **Step 1: Write the failing fixture page**

Create `plugins/test-them/fixtures/ui-page.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign in</title>
</head>
<body>
  <h1>Welcome back</h1>
  <form>
    <label>Email <input id="email" name="email"></label>
    <button type="submit">Sign in</button>
  </form>
  <p id="toast-error" hidden>Bad credentials</p>
</body>
</html>
```

- [ ] **Step 2: Replace `ui.mjs` with the runner below**

Keep Playwright lazy-import. If Playwright is missing, throw the same install message as today.

```js
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
```

Note: `uiProbe` now returns an **array**. Update every caller in the next task. Do not leave `session.lastRun.cases.push(uiCase)` assuming a single object.

- [ ] **Step 3: Smoke without Playwright**

Run:

```bash
cd plugins/test-them && node -e "import('./src/ui.mjs').then(m => m.uiProbe({url:'http://127.0.0.1/'})).catch(e => { console.log(e.message); process.exit(0); })"
```

Expected: message starts with `Playwright not installed` if Playwright is absent. If Playwright is present, it will try to navigate and fail on connection. Both are OK for this step.

- [ ] **Step 4: Commit**

```bash
git add plugins/test-them/src/ui.mjs plugins/test-them/fixtures/ui-page.html
git commit -m "feat: thicken ui_probe expects and viewports"
```

---

### Task 3: MCP schema + attach all viewport cases

**Files:**
- Modify: `plugins/test-them/src/server.mjs` (the `ui_probe` tool only)

**Interfaces:**
- Consumes: `uiProbe(input) -> Promise<UiCase[]>`
- Produces: MCP result JSON `{ cases, attached }` where `cases` is the array

- [ ] **Step 1: Replace the `ui_probe` tool block**

In `plugins/test-them/src/server.mjs` replace the existing `ui_probe` tool (from `server.tool("ui_probe"` through its closing `);`) with:

```js
server.tool(
  "ui_probe",
  "Live Playwright page probe. Only when the user asked to test a page. Optional Playwright.",
  {
    url: z.string(),
    steps: z
      .array(
        z.object({
          action: z.string(),
          selector: z.string().optional(),
          value: z.string().optional(),
          urlIncludes: z.string().optional(),
          expects: z
            .array(
              z.object({
                kind: z.enum([
                  "seeText",
                  "noText",
                  "urlIncludes",
                  "titleIncludes",
                  "visible",
                  "hidden",
                  "noConsoleError",
                ]),
                text: z.string().optional(),
                selector: z.string().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
    expects: z
      .array(
        z.object({
          kind: z.enum([
            "seeText",
            "noText",
            "urlIncludes",
            "titleIncludes",
            "visible",
            "hidden",
            "noConsoleError",
          ]),
          text: z.string().optional(),
          selector: z.string().optional(),
        }),
      )
      .optional(),
    viewports: z.array(z.enum(["desktop", "mobile"])).optional(),
    attach: z.boolean().optional(),
  },
  async (input) => {
    try {
      const cases = await uiProbe(input);
      if (session.lastRun && input.attach !== false) {
        session.lastRun.cases.push(...cases);
        for (const uiCase of cases) {
          if (uiCase.verdict !== "pass") {
            session.lastRun.findings.push({
              severity: uiCase.verdict,
              caseId: uiCase.id,
              text: uiCase.reason,
            });
          }
        }
      }
      return ok({ attached: Boolean(session.lastRun && input.attach !== false), cases });
    } catch (err) {
      return fail(err);
    }
  },
);
```

- [ ] **Step 2: Syntax check**

Run:

```bash
cd plugins/test-them && node --check src/server.mjs
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add plugins/test-them/src/server.mjs
git commit -m "feat: accept ui expects and viewports on ui_probe"
```

---

### Task 4: Report shows UI expects and data-URL shots

**Files:**
- Modify: `plugins/test-them/templates/report.html` (JS `show()` and `.shots` only)
- Modify: `plugins/test-them/schemas/run.schema.json`

**Interfaces:**
- Consumes: `c.uiExpects.hits/misses`, `c.screenshots[].src` as data URLs
- Produces: brief tiles for each expect; shots still in response body pane

- [ ] **Step 1: Extend the case schema**

In `plugins/test-them/schemas/run.schema.json` inside `$defs.case.properties` add:

```json
"screenshots": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "step": { "type": "string" },
      "src": { "type": "string" }
    }
  }
},
"uiExpects": {
  "type": "object",
  "properties": {
    "hits": { "type": "array" },
    "misses": { "type": "array" }
  }
}
```

- [ ] **Step 2: Patch `show()` brief HTML**

In `plugins/test-them/templates/report.html`, inside `function show(c)`, after the existing four brief `<article>`s are assigned to `$("brief").innerHTML`, append UI expect tiles when `c.uiExpects` exists.

Replace the brief assignment so the last two articles stay Expected / Unexpected, then extra articles:

```js
      const expectTiles = (c.uiExpects?.hits || []).map((h) => `
        <article class="hit">
          <dt>UI expect</dt>
          <dd>${esc(h.detail)}</dd>
        </article>`).join("");
      const missTiles = (c.uiExpects?.misses || []).map((m) => `
        <article class="miss">
          <dt>UI miss</dt>
          <dd>${esc(m.detail)}</dd>
        </article>`).join("");
      $("brief").innerHTML = `
        <article>
          <dt>Scenario</dt>
          <dd>${esc(c.scenario || c.title)}</dd>
        </article>
        <article>
          <dt>Purpose</dt>
          <dd>${esc(c.purpose || "")}</dd>
        </article>
        <article class="hit">
          <dt>Expected</dt>
          <dd>${esc(c.expectedText || (c.expect?.status || []).join(" / "))}</dd>
        </article>
        <article class="${unexpected ? "miss" : "hit"}">
          <dt>Unexpected</dt>
          <dd>${esc(unexpected ? unexpected.text : "None. Result matches the test objective.")}</dd>
        </article>${expectTiles}${missTiles}`;
```

Shots already render from `c.screenshots`. Data URLs work in `<img src>` with no extra change. Confirm the existing mapper is:

```js
current.screenshots.map((s) => `<figure class="shots"><figcaption>${esc(s.step)}</figcaption><img src="${esc(s.src)}" alt=""></figure>`)
```

Do not prefix `file://`. Leave `src` as stored.

- [ ] **Step 3: Static render check**

Run a tiny node inject (no Playwright) to prove the template still renders:

```bash
cd plugins/test-them && node --input-type=module -e '
import { renderRun } from "./src/render.mjs";
const run = {
  id: "ui-plan-check",
  startedAt: "2026-08-13T00:00:00.000Z",
  finishedAt: "2026-08-13T00:00:01.000Z",
  target: { method: "GET", url: "https://example.com/" },
  brand: { name: "test them", product: "HTTP evidence", owner: "Plan", mark: "tt" },
  cases: [{
    id: "ui-desktop", family: "ui", title: "UI flow (desktop)", live: true,
    startedAt: "2026-08-13T00:00:00.000Z", elapsedMs: 10,
    scenario: "Live desktop page", purpose: "See heading",
    expectedText: "see \"Welcome\"", unexpected: null,
    request: { method: "GET", url: "https://example.com/", headers: {}, body: {} },
    response: { status: 200, headers: {}, body: {} },
    verdict: "pass", reason: "ok",
    uiExpects: { hits: [{ kind: "seeText", detail: "saw \"Welcome\"" }], misses: [] },
    screenshots: [{ step: "open", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }]
  }],
  findings: []
};
const out = await renderRun(run, "../../reports/ui-plan-check.html");
const { readFile } = await import("node:fs/promises");
const html = await readFile(out.path, "utf8");
if (!html.includes("data:image/png;base64,")) throw new Error("shot missing");
if (!html.includes("test them")) throw new Error("brand missing");
console.log("ok", out.path);
'
```

Expected: `ok` and a path under `reports/`.

- [ ] **Step 4: Commit**

```bash
git add plugins/test-them/templates/report.html plugins/test-them/schemas/run.schema.json
git commit -m "feat: render ui expects and embedded shots"
```

---

### Task 5: Skill + self-check

**Files:**
- Modify: `plugins/test-them/skills/test-them/SKILL.md`
- Modify: `plugins/test-them/src/self-check.mjs`

**Interfaces:**
- Consumes: `uiProbe` array return; fixture `plugins/test-them/fixtures/ui-page.html`
- Produces: skill recipe; self-check still green without Playwright

- [ ] **Step 1: Update the skill**

Replace the `ui_probe` lines in `plugins/test-them/skills/test-them/SKILL.md` so Do / Do not / Tools read:

Do (add as step 5, only if the user named a page):

```markdown
5. If the user named a page, browser, screenshot, or UX check: call `ui_probe`
   with that URL and written `expects` (`seeText`, `visible`, `urlIncludes`).
   Optional `viewports: ["desktop","mobile"]`. Then `render` again.
```

Do not (keep the existing `ui_probe` line, tighten it):

```markdown
- Call `ui_probe` unless the user named a page, browser, Playwright, screenshot, or UX.
- Invent a page URL. Only open the URL they gave.
```

Tools line:

```markdown
- `ui_probe` — live Playwright page. Optional install. Pass `expects` and optional `viewports`.
```

- [ ] **Step 2: Extend self-check**

At the top of `plugins/test-them/src/self-check.mjs` add:

```js
import { uiProbe } from "./ui.mjs";
```

Before `console.log`, add:

```js
  let uiStatus = "skipped";
  try {
    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/ui-page.html");
    const fixtureUrl = "file://" + fixture;
    const uiCases = await uiProbe({
      url: fixtureUrl,
      expects: [
        { kind: "seeText", text: "Welcome back" },
        { kind: "titleIncludes", text: "Sign in" },
        { kind: "visible", selector: "#email" },
      ],
      viewports: ["desktop"],
    });
    if (!uiCases[0] || uiCases[0].verdict !== "pass") {
      throw new Error("ui fixture should pass: " + (uiCases[0]?.reason || "no case"));
    }
    if (!(uiCases[0].screenshots || [])[0]?.src?.startsWith("data:image/png")) {
      throw new Error("ui shot must be embedded png");
    }
    const bad = await uiProbe({
      url: fixtureUrl,
      expects: [{ kind: "seeText", text: "This text is not on the page" }],
      viewports: ["desktop"],
    });
    if (bad[0].verdict !== "fail") throw new Error("missing text must fail");
    uiStatus = "ran";
  } catch (err) {
    if (String(err.message || err).includes("Playwright not installed")) {
      uiStatus = "skipped";
    } else {
      throw err;
    }
  }
```

Add `ui: uiStatus` to the `console.log` JSON.

- [ ] **Step 3: Run matcher tests + self-check**

Run:

```bash
cd plugins/test-them && npm test && npm run check
```

Expected:
- `ui-expect` tests PASS
- self-check JSON `ok: true`
- `ui` is `"skipped"` or `"ran"`
- Existing API assertions still hold

- [ ] **Step 4: Commit**

```bash
git add plugins/test-them/skills/test-them/SKILL.md plugins/test-them/src/self-check.mjs
git commit -m "docs: teach ui_probe expects; optional ui self-check"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Expects kinds | 1, 2 |
| Viewports desktop/mobile | 2, 3 |
| Console warn / `noConsoleError` | 1, 2 |
| Embedded PNG shots | 2, 4 |
| Case shape scenario/purpose/expected/unexpected | 2, 4 |
| Report brief + shots | 4 |
| Skill recipe | 5 |
| Self-check skip without Playwright | 5 |
| Playwright optional, no new required dep | 2, 5 |

## Self-review

- No TBD / "implement later"
- `uiProbe` return type is array in Task 2 and consumed as array in Task 3
- Viewport names locked: `desktop` / `mobile`
- Expect kinds locked to the seven strings in matcher + Zod
