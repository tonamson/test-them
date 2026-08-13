import { randomUUID } from "node:crypto";
import { liveCall, resolveUrl } from "./http.mjs";
import { EXPECT, judge } from "./verdict.mjs";
import { isSecretKey } from "./redact.mjs";
import { DEFAULT_BRAND, normalizeBrand } from "./session.mjs";

const DEFAULT_FAMILIES = ["happy", "validation", "auth", "protocol", "contract"];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function firstStringKey(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return Object.keys(obj).find((key) => typeof obj[key] === "string") || Object.keys(obj)[0] || null;
}

function wrongType(value) {
  if (typeof value === "string") return 123;
  if (typeof value === "number") return "not-a-number";
  if (typeof value === "boolean") return "yes";
  if (Array.isArray(value)) return {};
  return "x";
}

function otherMethod(method) {
  return method === "GET" ? "POST" : "GET";
}

function dropHeader(headers, name) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== name.toLowerCase()) out[key] = value;
  }
  return out;
}

function hasHeader(headers, name) {
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === name.toLowerCase());
}

export function buildMatrix(seed, { families = DEFAULT_FAMILIES } = {}) {
  const method = String(seed.method || "GET").toUpperCase();
  const headers = { ...(seed.headers || {}) };
  const body = seed.body;
  const objectBody = body && typeof body === "object" && !Array.isArray(body);
  const cases = [];

  const want = (name) => families.includes(name);
  const add = (item) => cases.push(item);

  if (want("happy")) {
    add({
      id: "happy",
      family: "happy",
      title: "seed request",
      scenario: "Happy path",
      purpose: "Verify the API accepts the seed request and returns success.",
      expectedText: `HTTP ${(seed.expect?.status || EXPECT.happy).join(" or ")}, request handled successfully.`,
      method,
      headers,
      body,
      expect: seed.expect?.status || EXPECT.happy,
    });
  }

  if (want("validation") && objectBody) {
    for (const key of Object.keys(body)) {
      const dropped = clone(body);
      delete dropped[key];
      add({
        id: `validation-drop-${key}`,
        family: "validation",
        title: `missing field ${key}`,
        scenario: `Missing field ${key}`,
        purpose: `API must reject the request when ${key} is omitted.`,
        expectedText: "HTTP 400 or 422, validation error.",
        method,
        headers,
        body: dropped,
        expect: EXPECT.validation,
      });
      if (typeof body[key] === "string") {
        const empty = clone(body);
        empty[key] = "";
        add({
          id: `validation-empty-${key}`,
          family: "validation",
          title: `empty string ${key}`,
          scenario: `Empty ${key}`,
          purpose: `API must reject an empty string for ${key}.`,
          expectedText: "HTTP 400 or 422, validation error.",
          method,
          headers,
          body: empty,
          expect: EXPECT.validation,
        });
      }
    }
    const first = firstStringKey(body);
    if (first) {
      const nulled = clone(body);
      nulled[first] = null;
      add({
        id: `validation-null-${first}`,
        family: "validation",
        title: `null ${first}`,
        scenario: `${first} = null`,
        purpose: `API must reject null for ${first}.`,
        expectedText: "HTTP 400 or 422, validation error.",
        method,
        headers,
        body: nulled,
        expect: EXPECT.validation,
      });
      const typed = clone(body);
      typed[first] = wrongType(body[first]);
      add({
        id: `validation-type-${first}`,
        family: "validation",
        title: `wrong type ${first}`,
        scenario: `Wrong type ${first}`,
        purpose: `API must reject ${first} when the JSON type is wrong.`,
        expectedText: "HTTP 400 or 422, validation error.",
        method,
        headers,
        body: typed,
        expect: EXPECT.validation,
      });
    }
  }

  if (want("auth")) {
    const authHeader = hasHeader(headers, "authorization") || hasHeader(headers, "cookie");
    const credKeys = objectBody ? Object.keys(body).filter((key) => isSecretKey(key)) : [];
    if (authHeader) {
      add({
        id: "auth-drop-authorization",
        family: "auth",
        title: "dropped Authorization / Cookie",
        scenario: "Missing token",
        purpose: "API must reject the request when Authorization/Cookie is absent.",
        expectedText: "HTTP 401 or 403.",
        method,
        headers: dropHeader(dropHeader(headers, "authorization"), "cookie"),
        body,
        expect: EXPECT.auth,
      });
      add({
        id: "auth-bad-bearer",
        family: "auth",
        title: "invalid bearer",
        scenario: "Invalid bearer",
        purpose: "API must reject an invalid bearer token.",
        expectedText: "HTTP 401 or 403.",
        method,
        headers: { ...dropHeader(headers, "authorization"), Authorization: "Bearer invalid" },
        body,
        expect: EXPECT.auth,
      });
    }
    for (const key of credKeys) {
      const bad = clone(body);
      bad[key] = "__probe_invalid__";
      add({
        id: `auth-bad-${key}`,
        family: "auth",
        title: `wrong ${key}`,
        scenario: `Wrong ${key}`,
        purpose: `API must reject an incorrect ${key}.`,
        expectedText: "HTTP 401 or 403.",
        method,
        headers,
        body: bad,
        expect: EXPECT.auth,
      });
    }
  }

  if (want("protocol")) {
    if (objectBody || typeof body === "string") {
      add({
        id: "protocol-malformed-json",
        family: "protocol",
        title: "malformed JSON",
        scenario: "Malformed JSON",
        purpose: "API must reject a body that cannot be parsed.",
        expectedText: "HTTP 400 or 415.",
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        rawBody: "{not-json",
        expect: [400, 415],
      });
      add({
        id: "protocol-plain-content-type",
        family: "protocol",
        title: "Content-Type text/plain",
        scenario: "Wrong Content-Type",
        purpose: "API must reject or refuse to parse JSON when Content-Type is not application/json.",
        expectedText: "HTTP 400, 404, 405, 415, or 501.",
        method,
        headers: { ...headers, "Content-Type": "text/plain" },
        body,
        expect: EXPECT.protocol,
      });
      add({
        id: "protocol-no-content-type",
        family: "protocol",
        title: "omitted Content-Type",
        scenario: "Missing Content-Type",
        purpose: "API must not silently accept JSON when Content-Type is omitted.",
        expectedText: "HTTP 400, 404, 405, 415, or 501.",
        method,
        headers: dropHeader(headers, "content-type"),
        rawBody: typeof body === "string" ? body : JSON.stringify(body ?? {}),
        expect: EXPECT.protocol,
      });
    }
    add({
      id: "protocol-wrong-method",
      family: "protocol",
      title: `wrong method ${otherMethod(method)}`,
      scenario: `Wrong method ${otherMethod(method)}`,
      purpose: "API must report an unsupported method, not treat it as a valid request.",
      expectedText: "HTTP 404, 405, or 501.",
      method: otherMethod(method),
      headers,
      body: otherMethod(method) === "GET" ? undefined : body,
      expect: [404, 405, 501],
    });
  }

  if (want("contract") && objectBody) {
    const extra = clone(body);
    extra.__probe = true;
    add({
      id: "contract-extra-field",
      family: "contract",
      title: "unexpected field __probe",
      scenario: "Unexpected field",
      purpose: "Check mass assignment: unknown fields must not be accepted silently.",
      expectedText: "Prefer 400/422. A 200/201 needs review.",
      method,
      headers,
      body: extra,
      expect: EXPECT.contract,
    });
    const key = firstStringKey(body);
    if (key && typeof body[key] === "string") {
      for (const size of [1000, 10000]) {
        const huge = clone(body);
        huge[key] = "x".repeat(size);
        add({
          id: `contract-oversize-${size}`,
          family: "contract",
          title: `${key} length ${size}`,
          scenario: `Oversized ${key} (${size})`,
          purpose: `API must limit ${key} length and must not crash.`,
          expectedText: "400, 413, 422, or success only if the server truncates.",
          method,
          headers,
          body: huge,
          expect: EXPECT.contract,
        });
      }
    }
  }

  return cases;
}

const PHRASE = {
  200: "OK",
  201: "Created",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  501: "Not Implemented",
  503: "Service Unavailable",
};

function apiErrorText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body.slice(0, 240);
  if (Array.isArray(body.message)) return body.message.join("; ");
  if (typeof body.message === "string") return body.message;
  if (body.error != null) return String(body.error);
  return "";
}

function unexpectedOf(built, status, body, networkError) {
  const wanted = built.expect || [];
  if (status === 0) {
    return {
      kind: "transport",
      text: networkError || "Could not reach the API.",
    };
  }
  if (wanted.includes(status)) return null;
  const detail = apiErrorText(body);
  const label = `${status}${PHRASE[status] ? " " + PHRASE[status] : ""}`;
  if (status >= 400) {
    return {
      kind: "other_error",
      text: `API returned a different error than expected: ${label}${detail ? " - " + detail : ""}. This does not match the test objective.`,
    };
  }
  return {
    kind: "accepted",
    text: `API accepted the request (HTTP ${label}) but the test expected a rejection (${wanted.join("/")}).`,
  };
}

function toPublicCase(built, result) {
  const status = result.response.status;
  const judged = judge(built.family, status, built.expect);
  const unexpected = unexpectedOf(built, status, result.response.body, result.response.error);
  return {
    id: built.id,
    family: built.family,
    title: built.title,
    scenario: built.scenario || built.title,
    purpose: built.purpose || "",
    expectedText: built.expectedText || `HTTP ${(built.expect || []).join(" or ")}`,
    unexpected,
    live: true,
    startedAt: result.startedAt,
    elapsedMs: result.elapsedMs,
    request: result.request,
    response: result.response,
    expect: { status: built.expect },
    verdict: judged.verdict,
    reason: judged.reason,
  };
}

function findingsFrom(cases) {
  return cases
    .filter((item) => item.verdict === "fail" || item.verdict === "warn")
    .map((item) => ({
      severity: item.verdict,
      caseId: item.id,
      text: `${item.scenario || item.title}: ${item.reason}`,
    }));
}

export async function diagnose(seed, session = {}) {
  const url = resolveUrl(seed.url, session.baseUrl);
  const headers = { ...(session.headers || {}), ...(seed.headers || {}) };
  const families = seed.families || DEFAULT_FAMILIES;
  const built = buildMatrix({ ...seed, url, headers }, { families });
  const startedAt = new Date().toISOString();
  const cases = [];
  const rawById = {};

  for (const item of built) {
    const result = await liveCall({
      method: item.method,
      url,
      headers: { ...(session.headers || {}), ...item.headers },
      body: item.body,
      rawBody: item.rawBody,
      timeoutMs: session.timeoutMs,
    });
    rawById[item.id] = result.rawBody;
    cases.push(toPublicCase(item, result));
  }

  const finishedAt = new Date().toISOString();
  const findings = findingsFrom(cases);
  if (session.spec?.operations?.length) {
    const hit = `${seed.method || "GET"} ${new URL(url).pathname}`;
    const leftover = session.spec.operations.filter(
      (op) => `${op.method} ${op.path}` !== hit && !hit.includes(op.path.replace(/\{[^}]+\}/g, "")),
    );
    if (leftover.length) {
      findings.push({
        severity: "info",
        caseId: "happy",
        text: `${leftover.length} spec operations not hit this run`,
      });
    }
  }

  return {
    run: {
      id: randomUUID(),
      target: { method: String(seed.method || "GET").toUpperCase(), url },
      startedAt,
      finishedAt,
      baseUrl: session.baseUrl,
      brand: normalizeBrand(session.brand || {}, DEFAULT_BRAND),
      spec: session.spec
        ? { source: session.spec.source, operations: session.spec.operations.length }
        : undefined,
      cases,
      findings: findings.filter((item) => item.severity !== "info"),
    },
    rawById,
  };
}
