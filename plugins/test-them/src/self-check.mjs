import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { diagnose } from "./diagnose.mjs";
import { renderRun } from "./render.mjs";
import { uiProbe } from "./ui.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.method === "GET" && req.url.startsWith("/login")) {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 405, message: ["Method Not Allowed"] }));
      return;
    }
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 400, message: ["Malformed JSON"] }));
      return;
    }
    if (body.username == null || body.password == null || body.username === "" || body.password === "") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 400, message: ["username and password required"] }));
      return;
    }
    if (body.password !== "123123") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: 401, message: ["Invalid credentials"] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        statusCode: 200,
        data: { accessToken: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb" },
        message: "",
      }),
    );
  });
});

const port = await listen(server);
const base = `http://127.0.0.1:${port}`;

try {
  const { run } = await diagnose(
    {
      method: "POST",
      url: `${base}/login`,
      headers: { "Content-Type": "application/json" },
      body: { username: "admin", password: "123123" },
    },
    {
      brand: {
        name: "test them",
        product: "HTTP evidence",
        owner: "Self-Check Lab",
        mark: "tt",
      },
    },
  );

  if (!run.cases.length) throw new Error("no cases");
  if (!run.cases.every((c) => c.live === true)) throw new Error("not live");
  if (!run.cases.every((c) => c.purpose && c.expectedText && c.scenario)) {
    throw new Error("case missing purpose/expected/scenario");
  }
  const typeCase = run.cases.find((c) => c.id === "validation-type-username");
  if (!typeCase?.unexpected) throw new Error("wrong-type case must flag unexpected API result");

  const happy = run.cases.find((c) => c.id === "happy");
  if (!happy || happy.response.status !== 200) throw new Error("happy did not hit 200");
  if (JSON.stringify(happy.request.body).includes("123123")) throw new Error("password not redacted in request");
  if (JSON.stringify(happy.response.body).includes("eyJhbG")) throw new Error("jwt not redacted in response");

  const down = await diagnose({
    method: "GET",
    url: "http://127.0.0.1:1/",
    families: ["happy"],
  });
  if (down.run.cases[0].response.status !== 0) throw new Error("down target must be status 0");
  if (down.run.cases[0].verdict !== "fail") throw new Error("down target must fail");

  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../reports/self-check.html");
  const rendered = await renderRun(run, out);
  const html = await readFile(rendered.path, "utf8");
  if (!html.includes(run.id)) throw new Error("html missing run id");
  if (html.includes("123123")) throw new Error("password leaked into html");
  if (/[\u1EA0-\u1EF9đĐ]/.test(html) || /\bSai\b/.test(html)) {
    throw new Error("non-English copy in html");
  }
  if (!html.includes("test them") || !html.includes("Self-Check Lab")) {
    throw new Error("brand identity missing from html");
  }
  if (!html.includes('data-logo="test-them"') || !html.includes("data:image/png;base64,") || !html.includes('id="logoImg"')) {
    throw new Error("brand logo image missing from html");
  }
  if (/>\s*API Probe\s*</.test(html) || html.includes(">API Probe<") || html.includes("PROOF") || html.includes("test it")) {
    throw new Error("legacy brand still present");
  }

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

  console.log(
    JSON.stringify({
      ok: true,
      cases: run.cases.length,
      passed: run.cases.filter((c) => c.verdict === "pass").length,
      failed: run.cases.filter((c) => c.verdict === "fail").length,
      report: rendered.path,
      ui: uiStatus,
    }),
  );
} finally {
  server.close();
}
