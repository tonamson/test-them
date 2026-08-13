import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExpects } from "./ui-expect.mjs";

const snap = {
  url: "http://127.0.0.1/login",
  title: "Sign in",
  text: "Welcome back Email Password",
  visible: ["#email", "button[type=submit]"],
  hidden: ["#toast-error"],
  consoleErrors: [],
};

test("seeText hits when page text contains needle", () => {
  const out = evaluateExpects(snap, [{ kind: "seeText", text: "Welcome back" }]);
  assert.equal(out.misses.length, 0);
  assert.equal(out.hits[0].kind, "seeText");
});

test("seeText misses when needle absent", () => {
  const out = evaluateExpects(snap, [{ kind: "seeText", text: "Dashboard" }]);
  assert.equal(out.misses.length, 1);
  assert.match(out.unexpected.text, /Dashboard/);
});

test("noText fails when needle is present", () => {
  const out = evaluateExpects(snap, [{ kind: "noText", text: "Welcome back" }]);
  assert.equal(out.misses.length, 1);
});

test("urlIncludes and titleIncludes", () => {
  const out = evaluateExpects(snap, [
    { kind: "urlIncludes", text: "/login" },
    { kind: "titleIncludes", text: "Sign" },
  ]);
  assert.equal(out.misses.length, 0);
});

test("visible and hidden selectors", () => {
  const out = evaluateExpects(snap, [
    { kind: "visible", selector: "#email" },
    { kind: "hidden", selector: "#toast-error" },
  ]);
  assert.equal(out.misses.length, 0);
});

test("noConsoleError fails when consoleErrors exist", () => {
  const dirty = { ...snap, consoleErrors: ["Uncaught TypeError"] };
  const out = evaluateExpects(dirty, [{ kind: "noConsoleError" }]);
  assert.equal(out.misses.length, 1);
});

test("empty expects is a clean hit list", () => {
  const out = evaluateExpects(snap, []);
  assert.equal(out.hits.length, 0);
  assert.equal(out.misses.length, 0);
  assert.equal(out.unexpected, null);
});
