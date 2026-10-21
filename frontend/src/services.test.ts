import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCommand, catalogueCommand, DEFAULT_STARRED, filterServices, isValidLocation, matchCommand, SERVICES, serviceById,
} from "./services.ts";
import { MAX_FREQUENT, ServicePrefs } from "./servicePrefs.ts";
import type { StorageLike } from "./cache.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

test("catalogue ids are unique and defaults exist", () => {
  assert.equal(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length);
  for (const id of DEFAULT_STARRED) assert.ok(serviceById(id), id);
});

test("catalogue commands are list commands and never set reserved flags", () => {
  for (const s of SERVICES) {
    assert.ok(s.args.includes("list"), s.id);
    assert.ok(!s.args.some((a) => a.startsWith("--format") || a.startsWith("--project")), s.id);
  }
});

test("buildCommand", () => {
  assert.deepEqual(buildCommand(serviceById("buckets")!), {
    text: "storage buckets list", args: ["storage", "buckets", "list"], runnable: true,
  });
  assert.deepEqual(buildCommand(serviceById("scheduler")!), {
    text: "scheduler jobs list --location=", args: ["scheduler", "jobs", "list", "--location="], runnable: false,
  });
  assert.equal(buildCommand(serviceById("scheduler")!, "europe-west2").text, "scheduler jobs list --location=europe-west2");
  assert.equal(buildCommand(serviceById("redis")!, "us-east1").runnable, true);
});

test("matchCommand round-trips and extracts location", () => {
  for (const s of SERVICES) {
    const m = matchCommand(buildCommand(s, "europe-west2").args);
    assert.equal(m?.service.id, s.id);
    assert.equal(m?.location, s.locationFlag ? "europe-west2" : "");
  }
  assert.equal(matchCommand(["compute", "instances", "list", "--filter=x"]), undefined);
  assert.equal(matchCommand(["scheduler", "jobs", "list", "--region=x"]), undefined);
  assert.equal(matchCommand(["compute", "instances", "delete", "vm-1"]), undefined);
});

test("catalogueCommand only recognises complete catalogue list commands", () => {
  assert.equal(catalogueCommand("storage buckets list")?.runnable, true);
  assert.equal(catalogueCommand("gcloud  storage buckets list ")?.service.id, "buckets");
  assert.equal(catalogueCommand("scheduler jobs list --location=")?.runnable, false);
  assert.equal(catalogueCommand("scheduler jobs list --location=europe-west2")?.runnable, true);
  assert.equal(catalogueCommand("scheduler jobs list --location='x;y'")?.runnable, false);
  for (const not of ["", "storage buckets delete gs://b", "storage buckets list --filter=x", "compute instances list \"oops"]) {
    assert.equal(catalogueCommand(not), undefined, not);
  }
});

test("filterServices", () => {
  assert.deepEqual(filterServices(SERVICES, "migs").map((s) => s.id), ["migs"]);
  assert.deepEqual(filterServices(SERVICES, "managed groups").map((s) => s.id), ["migs"]);
  assert.ok(filterServices(SERVICES, "pubsub").every((s) => s.id.startsWith("pubsub")));
  assert.equal(filterServices(SERVICES, "").length, SERVICES.length);
  assert.equal(filterServices(SERVICES, "zzz").length, 0);
});

test("isValidLocation", () => {
  for (const ok of ["europe-west2", "us-central1-a", "global", "us"]) assert.ok(isValidLocation(ok), ok);
  for (const bad of ["", "-", "Europe", "eu west", "x;y", "--project=x", "a"]) assert.ok(!isValidLocation(bad), bad);
});

test("frequent: starred defaults first, then ranked by use", () => {
  let now = 1;
  const storage = new MemStorage();
  const p = new ServicePrefs(storage, () => now++);
  assert.deepEqual(p.frequent().map((s) => s.id), ["vms", "migs", "buckets", "scheduler", "workflows"]);

  p.recordUse("workflows");
  p.recordUse("workflows");
  p.recordUse("secrets");
  assert.deepEqual(p.frequent().map((s) => s.id).slice(0, 2), ["workflows", "secrets"]);

  p.toggleStar("vms");
  assert.ok(!p.isStarred("vms"));
  assert.ok(!p.frequent().some((s) => s.id === "vms"));

  const again = new ServicePrefs(storage);
  assert.deepEqual(again.frequent().map((s) => s.id), p.frequent().map((s) => s.id));
});

test("frequent is capped", () => {
  const p = new ServicePrefs(null);
  for (const s of SERVICES) p.recordUse(s.id);
  assert.equal(p.frequent().length, MAX_FREQUENT);
});

test("locations are validated and persisted", () => {
  const storage = new MemStorage();
  const p = new ServicePrefs(storage);
  p.setLocation("scheduler", "europe-west2");
  p.setLocation("workflows", "bad value");
  assert.equal(new ServicePrefs(storage).location("scheduler"), "europe-west2");
  assert.equal(p.location("workflows"), "");
});

test("corrupt saved prefs fall back to defaults", () => {
  const storage = new MemStorage();
  storage.setItem("gcpui:services", "{nope");
  assert.equal(new ServicePrefs(storage).frequent().length, DEFAULT_STARRED.length);
  storage.setItem("gcpui:services", JSON.stringify({ locations: { scheduler: "x;rm" }, starred: [1, "buckets"] }));
  const p = new ServicePrefs(storage);
  assert.equal(p.location("scheduler"), "");
  assert.deepEqual(p.frequent().map((s) => s.id), ["buckets"]);
});
