export const EXPECT = {
  happy: [200, 201],
  validation: [400, 422],
  auth: [401, 403],
  protocol: [400, 404, 405, 415, 501],
  contract: [200, 201, 400, 413, 422],
  spec: [400, 401, 403, 404, 409, 422],
};

export function judge(family, status, expect) {
  const wanted = expect?.length ? expect : EXPECT[family] || [200];
  if (status === 0) return { verdict: "fail", reason: "connection failed" };
  if (family === "contract" && status >= 200 && status < 300) {
    return { verdict: "warn", reason: `extra or oversized input accepted (${status})` };
  }
  if (wanted.includes(status)) return { verdict: "pass", reason: `status ${status}` };
  if (family === "protocol" && status >= 400) {
    return { verdict: "warn", reason: `got ${status}, expected ${wanted.join("|")}` };
  }
  if (family === "happy" && status >= 200 && status < 300) {
    return { verdict: "pass", reason: `status ${status}` };
  }
  return { verdict: "fail", reason: `expected ${wanted.join("|")}, got ${status}` };
}

export function sortCases(cases) {
  const rank = { fail: 0, warn: 1, pass: 2 };
  return [...cases].sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9));
}
