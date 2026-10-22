import { test } from "node:test";
import assert from "node:assert/strict";
import { ageText, MAX_ENTRIES, RESULT_MAX_AGE_MS, ResultCache } from "./resultCache.ts";
import type { StorageLike } from "./cache.ts";
import type { RunResponse } from "./api.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  failAbove = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (v.length > this.failAbove) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const resp = (n: number): RunResponse => ({ output: [{ n }], stderr: "", exitCode: 0, durationMs: 1 });
const VMS = ["compute", "instances", "list"];

test("default maximum age is 3600 seconds", () => {
  assert.equal(RESULT_MAX_AGE_MS, 3_600_000);
});

test("fresh within max age, per project and command", () => {
  let now = 0;
  const c = new ResultCache(null, 1000, () => now);
  c.put("p1", VMS, resp(1));
  assert.deepEqual(c.fresh("p1", VMS)?.response.output, [{ n: 1 }]);
  assert.equal(c.fresh("p2", VMS), undefined);
  assert.equal(c.fresh("p1", ["storage", "buckets", "list"]), undefined);
  now = 999;
  assert.ok(c.fresh("p1", VMS));
  now = 1000;
  assert.equal(c.fresh("p1", VMS), undefined);
});

test("put replaces and restarts the clock", () => {
  let now = 0;
  const c = new ResultCache(null, 1000, () => now);
  c.put("p", VMS, resp(1));
  now = 900;
  c.put("p", VMS, resp(2));
  now = 1500;
  assert.deepEqual(c.fresh("p", VMS)?.response.output, [{ n: 2 }]);
});

test("persists across instances", () => {
  const s = new MemStorage();
  new ResultCache(s).put("p", VMS, resp(7));
  assert.deepEqual(new ResultCache(s).fresh("p", VMS)?.response.output, [{ n: 7 }]);
});

test("keys cannot collide through separators in args", () => {
  const c = new ResultCache(null);
  c.put("p", ["a b", "c"], resp(1));
  assert.equal(c.fresh("p", ["a", "b c"]), undefined);
});

test("oldest entries are evicted beyond the cap", () => {
  const c = new ResultCache(null);
  for (let i = 0; i <= MAX_ENTRIES; i++) c.put(`p${i}`, VMS, resp(i));
  assert.equal(c.fresh("p0", VMS), undefined);
  assert.ok(c.fresh(`p${MAX_ENTRIES}`, VMS));
});

test("full storage evicts old entries instead of failing", () => {
  const s = new MemStorage();
  const c = new ResultCache(s);
  for (let i = 0; i < 10; i++) c.put(`p${i}`, VMS, resp(i));
  s.failAbove = 400;
  c.put("new", VMS, resp(99));
  assert.ok(c.fresh("new", VMS), "newest kept");
  assert.ok((s.getItem("gcpui:results") ?? "").length <= 400);
});

test("corrupt storage is ignored", () => {
  const s = new MemStorage();
  s.setItem("gcpui:results", "{nope");
  assert.equal(new ResultCache(s).fresh("p", VMS), undefined);
  s.setItem("gcpui:results", JSON.stringify([["k", { fetchedAt: "x" }], 5]));
  assert.equal(new ResultCache(s).fresh("p", VMS), undefined);
});

test("ageText", () => {
  assert.equal(ageText(10_000), "just now");
  assert.equal(ageText(4 * 60_000), "4 min ago");
  assert.equal(ageText(65 * 60_000), "1 h 5 min ago");
  assert.equal(ageText(120 * 60_000), "2 h ago");
});
