/** Visible product identity. Package id: test-them. */
export const DEFAULT_BRAND = {
  name: "test them",
  product: "HTTP evidence",
  owner: "",
  mark: "tt",
};

export function createSession() {
  return {
    baseUrl: undefined,
    headers: {},
    specHeaders: {},
    allowWrite: false,
    timeoutMs: 15000,
    brand: { ...DEFAULT_BRAND },
    spec: null,
    lastRun: null,
    rawById: {},
  };
}

export function normalizeBrand(input = {}, base = DEFAULT_BRAND) {
  const next = { ...base };
  if (input.name != null && String(input.name).trim()) next.name = String(input.name).trim();
  if (input.product != null && String(input.product).trim()) next.product = String(input.product).trim();
  if (input.owner != null) next.owner = String(input.owner).trim();
  if (input.mark != null && String(input.mark).trim()) {
    next.mark = String(input.mark).trim().slice(0, 2).toUpperCase();
  } else if (input.name != null && String(input.name).trim()) {
    next.mark = String(input.name).trim().slice(0, 1).toUpperCase();
  }
  return next;
}

export function configure(session, input = {}) {
  if (input.baseUrl != null) session.baseUrl = input.baseUrl;
  if (input.headers) session.headers = { ...session.headers, ...input.headers };
  if (input.specHeaders) session.specHeaders = { ...session.specHeaders, ...input.specHeaders };
  if (input.allowWrite != null) session.allowWrite = Boolean(input.allowWrite);
  if (input.timeoutMs != null) session.timeoutMs = Number(input.timeoutMs) || session.timeoutMs;
  if (input.brand) session.brand = normalizeBrand(input.brand, session.brand || DEFAULT_BRAND);
  return {
    baseUrl: session.baseUrl,
    allowWrite: session.allowWrite,
    timeoutMs: session.timeoutMs,
    brand: session.brand,
    headers: session.headers,
    specHeaders: session.specHeaders,
  };
}
