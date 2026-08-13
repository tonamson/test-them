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
