import { test } from "node:test";
import assert from "node:assert/strict";
import { SWRCache, type StorageLike } from "./cache.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

test("fresh entries are served without fetching", async () => {
  let now = 1000;
  const c = new SWRCache(new MemStorage(), "t:", 100, () => now);
  let calls = 0;
  const fetcher = async () => ++calls;
  assert.equal((await c.fetch("k", fetcher)).value, 1);
  now += 50;
  assert.equal((await c.fetch("k", fetcher)).value, 1);
  now += 100;
  assert.equal((await c.fetch("k", fetcher)).value, 2);
  assert.equal((await c.fetch("k", fetcher, true)).value, 3);
});

test("concurrent fetches are de-duplicated", async () => {
  const c = new SWRCache(null, "t:", 100);
  let calls = 0;
  const fetcher = () => new Promise<number>((r) => setTimeout(() => r(++calls), 5));
  const [a, b] = await Promise.all([c.fetch("k", fetcher), c.fetch("k", fetcher)]);
  assert.equal(calls, 1);
  assert.equal(a.value, b.value);
});

test("entries persist across instances via storage", async () => {
  const storage = new MemStorage();
  await new SWRCache(storage, "t:", 100).fetch("k", async () => ["x"]);
  const again = new SWRCache(storage, "t:", 100);
  assert.deepEqual(again.peek("k")?.value, ["x"]);
});

test("failed fetches are not cached", async () => {
  const c = new SWRCache(null, "t:", 100);
  await assert.rejects(c.fetch("k", async () => { throw new Error("boom"); }));
  assert.equal(c.peek("k"), undefined);
  assert.equal((await c.fetch("k", async () => 7)).value, 7);
});

test("corrupt storage entries are dropped", () => {
  const storage = new MemStorage();
  storage.setItem("t:k", "{not json");
  assert.equal(new SWRCache(storage, "t:", 100).peek("k"), undefined);
  assert.equal(storage.getItem("t:k"), null);
});

test("clear removes only prefixed keys", async () => {
  const storage = new MemStorage();
  storage.setItem("other", "keep");
  const c = new SWRCache(storage, "t:", 100);
  await c.fetch("a", async () => 1);
  await c.fetch("b", async () => 2);
  c.clear();
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem("other"), "keep");
  assert.equal(c.peek("a"), undefined);
});
