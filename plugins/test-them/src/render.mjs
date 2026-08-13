import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT ||
  process.env.GROK_PLUGIN_ROOT ||
  process.env.PLUGIN_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEMPLATE = path.join(PLUGIN_ROOT, "templates", "report.html");

function stampName(run) {
  const method = (run.target?.method || "GET").toLowerCase();
  const url = run.target?.url || "request";
  let hostpath = url;
  try {
    const parsed = new URL(url);
    hostpath = `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    hostpath = url.replace(/^https?:\/\//, "");
  }
  const slug = hostpath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const time = (run.startedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `${method}-${slug}-${time}.html`;
}

export async function renderRun(run, out) {
  if (!run || !Array.isArray(run.cases)) {
    throw new Error("render refused: no run");
  }
  const target = out || path.join(process.cwd(), "reports", stampName(run));
  const abs = path.resolve(target);
  await mkdir(path.dirname(abs), { recursive: true });
  const template = await readFile(TEMPLATE, "utf8");
  if (!template.includes("/*__RUN__*/")) {
    throw new Error("template missing /*__RUN__*/ marker");
  }
  const json = JSON.stringify(run).replace(/</g, "\\u003c");
  const html = template.replace("/*__RUN__*/ null", json);
  await writeFile(abs, html, "utf8");
  const passed = run.cases.filter((item) => item.verdict === "pass").length;
  const failed = run.cases.filter((item) => item.verdict === "fail").length;
  return {
    path: abs,
    passed,
    failed,
    findings: (run.findings || []).slice(0, 8),
  };
}
