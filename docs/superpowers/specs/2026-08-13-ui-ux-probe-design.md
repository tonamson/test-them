# UI/UX probe upgrade design

Date: 2026-08-13
Package: `test-them`
Extends: `docs/superpowers/specs/2026-08-13-api-probe-design.md`

## Problem

`ui_probe` today is a thin Playwright driver: open URL, `fill` / `click` / `wait`, screenshot to disk, pass if no throw. That is not a UI test.

Gaps:

- No assertions (page can be wrong and still pass)
- Screenshots are filesystem paths; HTML report breaks when moved
- One viewport only
- No console / pageerror capture
- No English scenario / purpose / expected / unexpected like API cases
- Skill tells the agent *not* to call `ui_probe` unless the user names a browser; no recipe when they do
- Self-check never exercises the UI path

## In scope (v1)

Thicken `ui_probe` into a live UI evidence case that matches the API report contract.

1. **Expects** after load and after each step (or as a final `expects` list):
   - `seeText` / `noText` (visible substring)
   - `urlIncludes`
   - `titleIncludes`
   - `visible` / `hidden` (CSS selector)
2. **Viewports:** `desktop` (1440x900) default. Optional `mobile` (390x844) as a second pass on the same flow.
3. **Console:** collect `console.error` and `pageerror`. Presence is `warn` unless `expects` includes `{ kind: "noConsoleError" }` (then `fail`).
4. **Standalone shots:** embed PNG as `data:image/png;base64,...` on the case. Keep optional `src` path for local debug.
5. **Case shape:** same fields as API cases (`scenario`, `purpose`, `expectedText`, `unexpected`, `verdict`, `reason`, `family: "ui"`). Multiple viewports = multiple cases (`ui-desktop`, `ui-mobile`).
6. **Report:** show expects hit/miss in the existing brief grid; shots stay in the response pane.
7. **Skill:** when the user names a page / browser / screenshot / UX, call `ui_probe` with written expects. Still never invent a page URL.
8. **Self-check:** local static HTML fixture + `ui_probe` if Playwright is installed; skip with an explicit `ui: "skipped"` field if not.

Playwright stays an **optional** dependency (lazy `import`). No new required npm package.

## Out of scope

- Pixel visual regression / screenshot diff
- axe-core / WCAG engine
- Native iOS / Android
- Multi-tab, file upload, iframe-heavy apps
- Making Playwright a hard dependency
- Jest / Playwright test-file codegen
- Load / a11y scoring bars

## Approaches considered

1. **Thicken `ui_probe` in place** (chosen). Same MCP tool, richer input/output. Least surface change.
2. New `ui_diagnose` tool. Split API vs UI. Extra skill complexity, two attach paths.
3. Require Playwright + axe. Heavier install, fights v1 non-goal "default Playwright".

## Data

```text
ui_probe({
  url,
  steps?: [{ action, selector?, value?, urlIncludes?, expects? }],
  expects?: [{ kind, text?, selector? }],
  viewports?: ["desktop"] | ["desktop","mobile"] | ["mobile"],
  attach?: true
})
```

`kind`: `seeText` | `noText` | `urlIncludes` | `titleIncludes` | `visible` | `hidden` | `noConsoleError`

Verdict: any failed expect → `fail`. Console noise without `noConsoleError` → `warn` if expects otherwise pass. No throw and all expects pass → `pass`.

## Files

- `plugins/test-them/src/ui-expect.mjs` — pure expect matcher (unit-tested, no browser)
- `plugins/test-them/src/ui.mjs` — Playwright runner
- `plugins/test-them/src/server.mjs` — tool schema
- `plugins/test-them/templates/report.html` — expects + embedded shots
- `plugins/test-them/schemas/run.schema.json` — optional `screenshots`, `expects`
- `plugins/test-them/skills/test-them/SKILL.md`
- `plugins/test-them/src/self-check.mjs` + `plugins/test-them/fixtures/ui-page.html`

## Success

1. Happy fixture with `seeText` passes; wrong `seeText` fails.
2. Report HTML contains `data:image/png` for UI shots (when Playwright ran).
3. `npm run check` still passes without Playwright.
4. Skill names expects and when to call `ui_probe`.
