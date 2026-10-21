import { test } from "node:test";
import assert from "node:assert/strict";
import { HierarchyStore, ORPHANS } from "./store.ts";
import type { StorageLike } from "./cache.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const responses: Record<string, unknown> = {
  "/organizations": [{ name: "organizations/1", displayName: "example.com" }],
  "/projects": [
    { projectId: "top-proj", name: "projects/11", parent: "organizations/1" },
    { projectId: "nested-proj", name: "projects/12", parent: "folders/20" },
    { projectId: "loose-proj", name: "projects/13" },
  ],
  "/organizations/1/folders": [{ name: "folders/20", displayName: "platform", parent: "organizations/1" }],
  "/organizations/1/projects": [{ projectId: "top-proj", name: "projects/11", parent: "organizations/1" }],
  "/folders/20/folders": [],
  "/folders/20/projects": [{ projectId: "nested-proj", name: "projects/12", parent: "folders/20" }],
};

function fakeFetcher(fail = new Set<string>()) {
  const calls: string[] = [];
  const fetch = async (path: string) => {
    calls.push(path);
    if (fail.has(path)) throw new Error(`boom ${path}`);
    if (!(path in responses)) throw new Error(`unexpected path ${path}`);
    return responses[path];
  };
  return { calls, fetch };
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

test("start loads orgs, all projects and the org's direct children", async () => {
  const f = fakeFetcher();
  const s = new HierarchyStore(f.fetch, new MemStorage(), errText);
  s.start();
  await flush();
  assert.equal(s.orgs.data?.length, 1);
  assert.equal(s.allProjects.data?.length, 3);
  assert.ok(s.expanded.has("organizations/1"), "orgs start expanded");
  const kids = s.children.get("organizations/1")?.data;
  assert.deepEqual(kids?.folders.map((x) => x.displayName), ["platform"]);
  assert.deepEqual(kids?.projects.map((x) => x.projectId), ["top-proj"]);
  assert.ok(!f.calls.includes("/folders/20/folders"), "folders load lazily");
});

test("toggle loads a folder's children and persists expansion", async () => {
  const storage = new MemStorage();
  const s = new HierarchyStore(fakeFetcher().fetch, storage, errText);
  s.start();
  await flush();
  const folder = s.children.get("organizations/1")!.data!.folders[0]!;
  s.toggle(folder);
  await flush();
  assert.deepEqual(s.children.get("folders/20")?.data?.projects.map((p) => p.projectId), ["nested-proj"]);
  assert.match(storage.getItem("gcpui:expanded") ?? "", /folders\/20/);
  s.toggle(folder);
  assert.ok(!s.expanded.has("folders/20"));
});

test("a second session paints from cache without refetching fresh data", async () => {
  const storage = new MemStorage();
  const first = new HierarchyStore(fakeFetcher().fetch, storage, errText);
  first.start();
  await flush();
  first.toggle(first.children.get("organizations/1")!.data!.folders[0]!);
  await flush();

  const f = fakeFetcher();
  const second = new HierarchyStore(f.fetch, storage, errText);
  second.start();
  assert.equal(second.orgs.status, "ok", "orgs available synchronously from cache");
  await flush();
  assert.deepEqual(f.calls, []);
  assert.equal(second.children.get("folders/20")?.data?.projects.length, 1, "expanded folder restored");
});

test("refresh refetches everything", async () => {
  const f = fakeFetcher();
  const s = new HierarchyStore(f.fetch, new MemStorage(), errText);
  s.start();
  await flush();
  const before = f.calls.length;
  s.refresh();
  await flush();
  assert.equal(f.calls.length - before, before);
});

test("errors are reported per node", async () => {
  const s = new HierarchyStore(fakeFetcher(new Set(["/organizations/1/projects"])).fetch, new MemStorage(), errText);
  s.start();
  await flush();
  const kids = s.children.get("organizations/1");
  assert.equal(kids?.status, "error");
  assert.match(kids?.error ?? "", /boom/);
  assert.equal(s.orgs.status, "ok");
});

test("orphans and paths", async () => {
  const s = new HierarchyStore(fakeFetcher().fetch, new MemStorage(), errText);
  s.start();
  await flush();
  assert.deepEqual(s.orphanProjects().map((p) => p.projectId), ["loose-proj"]);
  assert.ok(s.expanded.has(ORPHANS));
  const nested = s.allProjects.data!.find((p) => p.projectId === "nested-proj")!;
  assert.equal(s.pathOf(nested), "example.com / platform");
  const loose = s.allProjects.data!.find((p) => p.projectId === "loose-proj")!;
  assert.equal(s.pathOf(loose), "");
});
