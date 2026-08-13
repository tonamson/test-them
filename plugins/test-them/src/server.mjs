#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { liveCall, resolveUrl } from "./http.mjs";
import { diagnose } from "./diagnose.mjs";
import { loadSpec } from "./spec.mjs";
import { renderRun } from "./render.mjs";
import { authFrom } from "./auth.mjs";
import { uiProbe } from "./ui.mjs";
import { configure, createSession } from "./session.mjs";

const session = createSession();

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: err.message || String(err) }) }],
    isError: true,
  };
}

const jsonValue = z.any().optional();

const server = new McpServer({ name: "test-them", version: "0.1.0" });

server.tool(
  "configure",
  "Set baseUrl, default headers, allowWrite, timeout, and report brand (name/owner) for this session.",
  {
    baseUrl: z.string().optional(),
    headers: z.record(z.string()).optional(),
    specHeaders: z.record(z.string()).optional(),
    allowWrite: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    brand: z
      .object({
        name: z.string().optional(),
        product: z.string().optional(),
        owner: z.string().optional(),
        mark: z.string().optional(),
      })
      .optional(),
  },
  async (input) => ok(configure(session, input)),
);

server.tool(
  "load_spec",
  "Load OpenAPI, Swagger, or Postman JSON from a URL or file. Optional coverage map.",
  {
    source: z.string(),
    specHeaders: z.record(z.string()).optional(),
  },
  async ({ source, specHeaders }) => {
    try {
      if (specHeaders) session.specHeaders = { ...session.specHeaders, ...specHeaders };
      session.spec = await loadSpec(source, session);
      return ok({
        source: session.spec.source,
        operations: session.spec.operations.length,
        warnings: session.spec.warnings,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "call",
  "One live HTTP request. Returns redacted wire. Never mocked.",
  {
    method: z.string().optional(),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    body: jsonValue,
    expect: z.object({ status: z.array(z.number()).optional() }).optional(),
  },
  async (input) => {
    const url = resolveUrl(input.url, session.baseUrl);
    const result = await liveCall({
      method: input.method,
      url,
      headers: { ...session.headers, ...(input.headers || {}) },
      body: input.body,
      timeoutMs: session.timeoutMs,
    });
    session.rawById.call = result.rawBody;
    const status = result.response.status;
    const expect = input.expect?.status;
    const verdict =
      status === 0
        ? "fail"
        : expect && !expect.includes(status)
          ? "fail"
          : "pass";
    return ok({
      id: "call",
      family: "happy",
      title: "single call",
      live: true,
      startedAt: result.startedAt,
      elapsedMs: result.elapsedMs,
      request: result.request,
      response: result.response,
      expect: input.expect,
      verdict,
      reason: status === 0 ? "connection failed" : `status ${status}`,
    });
  },
);

server.tool(
  "diagnose",
  "Professional tester: seed request plus validation, auth, protocol, contract cases. Live only.",
  {
    method: z.string().optional(),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    body: jsonValue,
    families: z.array(z.string()).optional(),
    expect: z.object({ status: z.array(z.number()).optional() }).optional(),
  },
  async (input) => {
    const { run, rawById } = await diagnose(input, session);
    session.lastRun = run;
    session.rawById = { ...session.rawById, ...rawById };
    const passed = run.cases.filter((c) => c.verdict === "pass").length;
    const failed = run.cases.filter((c) => c.verdict === "fail").length;
    return ok({
      id: run.id,
      target: run.target,
      passed,
      failed,
      cases: run.cases.length,
      findings: run.findings,
      run,
    });
  },
);

server.tool(
  "auth_from",
  "Copy a token from a prior case body into the session Authorization header.",
  {
    caseId: z.string(),
    path: z.string().optional(),
    header: z.string().optional(),
    prefix: z.string().optional(),
  },
  async (input) => {
    try {
      return ok(authFrom(session, input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "render",
  "Write the fixed HTML report from a Run object. Pass run or uses last diagnose.",
  {
    run: z.any().optional(),
    out: z.string().optional(),
  },
  async (input) => {
    try {
      const run = input.run || session.lastRun;
      const summary = await renderRun(run, input.out);
      return ok(summary);
    } catch (err) {
      return fail(err);
    }
  },
);

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
      const slim = cases.map(({ screenshots, ...rest }) => ({
        ...rest,
        screenshots: (screenshots || []).map((s) => ({
          step: s.step,
          bytes: s.src ? Buffer.byteLength(s.src) : 0,
        })),
      }));
      return ok({
        attached: Boolean(session.lastRun && input.attach !== false),
        cases: slim,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
