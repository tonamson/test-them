import { getByPath } from "./ui.mjs";

export function authFrom(session, { caseId, path = "data.accessToken", header = "Authorization", prefix = "Bearer " }) {
  const raw = session.rawById?.[caseId];
  if (raw == null) throw new Error(`no raw body for case ${caseId}`);
  const value = getByPath(raw, path);
  if (value == null || value === "") throw new Error(`path ${path} empty on case ${caseId}`);
  session.headers[header] = `${prefix}${value}`;
  return { header, set: true, from: caseId };
}
