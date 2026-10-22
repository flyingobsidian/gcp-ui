import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECENT, pushRecent, RecentProjects } from "./recentProjects.ts";
import type { StorageLike } from "./cache.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

test("pushRecent moves to front, dedupes and caps", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(pushRecent(["a", "b"], "z"), ["z", "a", "b"]);
  assert.deepEqual(pushRecent(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
});

test("RecentProjects persists newest first and ignores empty ids", () => {
  const s = new MemStorage();
  const r = new RecentProjects(s);
  r.add("p1");
  r.add("p2");
  r.add("p1");
  r.add("");
  assert.deepEqual(new RecentProjects(s).ids, ["p1", "p2"]);
});

test("RecentProjects caps and tolerates corrupt storage", () => {
  const s = new MemStorage();
  const r = new RecentProjects(s);
  for (let i = 0; i < MAX_RECENT + 5; i++) r.add(`p${i}`);
  assert.equal(new RecentProjects(s).ids.length, MAX_RECENT);
  s.setItem("gcpui:recentProjects", "{nope");
  assert.deepEqual(new RecentProjects(s).ids, []);
  s.setItem("gcpui:recentProjects", JSON.stringify(["ok", 3, ""]));
  assert.deepEqual(new RecentProjects(s).ids, ["ok"]);
});
