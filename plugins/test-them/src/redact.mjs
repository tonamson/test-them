const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|signature|api[_-]?key/i;

export function isSecretKey(key) {
  return typeof key === "string" && SECRET_KEY.test(key);
}

export function redactString(value) {
  if (typeof value !== "string") return value;
  if (/^eyJ/.test(value)) return "eyJ***";
  return value;
}

export function redactHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key] = isSecretKey(key) ? "***" : redactString(String(value));
  }
  return out;
}

export function redactBody(body) {
  if (body == null) return body;
  if (typeof body === "string") {
    try {
      return redactBody(JSON.parse(body));
    } catch {
      return body;
    }
  }
  if (Array.isArray(body)) return body.map((item) => redactBody(item));
  if (typeof body === "object") {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
      if (isSecretKey(key)) out[key] = "***";
      else if (typeof value === "string") out[key] = redactString(value);
      else if (value && typeof value === "object") out[key] = redactBody(value);
      else out[key] = value;
    }
    return out;
  }
  return body;
}
