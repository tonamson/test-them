import { redactBody, redactHeaders } from "./redact.mjs";

export const MAX_BODY = 64 * 1024;

export function resolveUrl(url, baseUrl) {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return url;
  return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

function hostOf(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function encodeBody(body, rawBody) {
  if (rawBody != null) return typeof rawBody === "string" ? rawBody : String(rawBody);
  if (body == null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  return JSON.stringify(body);
}

function parseCaptured(buf) {
  const text = buf.toString("utf8");
  if (!text) return { body: null, truncated: false };
  try {
    return { body: JSON.parse(text), truncated: false };
  } catch {
    return { body: text, truncated: false };
  }
}

async function followSameHost(url, method, headers, payload, timeoutMs, hops = 0) {
  if (hops > 5) {
    const error = new Error("too many redirects");
    error.code = "REDIRECT";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      const next = new URL(location, url).href;
      if (hostOf(next) !== hostOf(url)) {
        const error = new Error(`redirect to different host blocked: ${next}`);
        error.code = "REDIRECT_HOST";
        throw error;
      }
      return followSameHost(next, method, headers, payload, timeoutMs, hops + 1);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function liveCall({
  method = "GET",
  url,
  headers = {},
  body,
  rawBody,
  timeoutMs = 15000,
} = {}) {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const verb = String(method || "GET").toUpperCase();
  const requestHeaders = { ...headers };
  const payload = encodeBody(body, rawBody);
  if (payload != null && !Object.keys(requestHeaders).some((k) => k.toLowerCase() === "content-type") && rawBody == null && typeof body === "object") {
    requestHeaders["Content-Type"] = "application/json";
  }

  const publicRequest = {
    method: verb,
    url,
    headers: redactHeaders(requestHeaders),
    body: redactBody(rawBody != null ? rawBody : body),
  };

  try {
    const res = await followSameHost(url, verb, requestHeaders, payload, timeoutMs);
    const raw = Buffer.from(await res.arrayBuffer());
    const truncated = raw.length > MAX_BODY;
    const slice = raw.subarray(0, MAX_BODY);
    const captured = parseCaptured(slice);
    const resHeaders = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });
    return {
      live: true,
      startedAt,
      elapsedMs: Math.round(performance.now() - t0),
      request: publicRequest,
      response: {
        status: res.status,
        headers: redactHeaders(resHeaders),
        body: redactBody(captured.body),
        truncated: truncated || undefined,
      },
      rawBody: captured.body,
    };
  } catch (err) {
    const message = err?.cause?.message || err?.message || String(err);
    return {
      live: true,
      startedAt,
      elapsedMs: Math.round(performance.now() - t0),
      request: publicRequest,
      response: {
        status: 0,
        headers: {},
        error: message,
      },
      rawBody: null,
    };
  }
}
