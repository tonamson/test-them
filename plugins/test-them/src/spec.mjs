import { resolveUrl } from "./http.mjs";

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function asJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`spec is not JSON (${source}): ${err.message}`);
  }
}

export function parseSpec(doc, source) {
  const warnings = [];
  const operations = [];

  if (doc.item && Array.isArray(doc.item)) {
    const walk = (items, prefix = "") => {
      for (const item of items) {
        if (item.item) walk(item.item, prefix);
        const req = item.request;
        if (!req) continue;
        const method = String(req.method || "GET").toUpperCase();
        const rawUrl = typeof req.url === "string" ? req.url : req.url?.raw || req.url?.path?.join("/") || "";
        operations.push({ method, path: rawUrl, auth: Boolean(req.auth), statuses: [] });
      }
    };
    walk(doc.item);
    return { source, operations, warnings };
  }

  const paths = doc.paths || {};
  if (!doc.paths) warnings.push("no paths in spec");
  if (!doc.servers?.length && !doc.host) warnings.push("no servers; use configure.baseUrl");

  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== "object") continue;
    for (const [method, op] of Object.entries(ops)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const statuses = Object.keys(op.responses || {})
        .map((code) => Number(code))
        .filter((code) => code > 0);
      const seen = new Set();
      for (const param of op.parameters || []) {
        const mark = `${param.in}:${param.name}`;
        if (seen.has(mark)) warnings.push(`duplicate param ${mark} on ${method.toUpperCase()} ${path}`);
        seen.add(mark);
      }
      operations.push({
        method: method.toUpperCase(),
        path,
        auth: Boolean(op.security || doc.security),
        statuses,
      });
    }
  }

  return { source, operations, warnings };
}

export async function loadSpec(input, session = {}) {
  let source = input;
  let text;
  if (/^https?:\/\//i.test(input) || (session.baseUrl && input.startsWith("/"))) {
    const url = resolveUrl(input, session.baseUrl);
    source = url;
    const headers = { ...(session.specHeaders || {}) };
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`spec fetch ${res.status} ${url}`);
    text = await res.text();
  } else {
    const { readFile } = await import("node:fs/promises");
    text = await readFile(input, "utf8");
  }
  return parseSpec(asJson(text, source), source);
}
