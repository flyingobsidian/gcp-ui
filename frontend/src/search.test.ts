import { test } from "node:test";
import assert from "node:assert/strict";
import { highlight, searchProjects } from "./search.ts";
import type { Project } from "./hierarchy.ts";

const p = (projectId: string, displayName = projectId): Project => ({
  kind: "project", key: `projects/${projectId}`, projectId, displayName, number: "", parent: "",
});

const projects = [
  p("acme-prod-billing", "Billing (prod)"),
  p("acme-test-billing", "Billing (test)"),
  p("prod-data", "Data Warehouse"),
  p("dev-alice", "Alice sandbox"),
];

const ids = (q: string, limit?: number) => searchProjects(projects, q, limit).map((m) => m.project.projectId);

test("empty query matches nothing", () => {
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("   "), []);
});

test("ID prefix ranks before substring before display name", () => {
  assert.deepEqual(ids("prod"), ["prod-data", "acme-prod-billing"]);
  assert.deepEqual(ids("ware"), ["prod-data"]);
});

test("every token must match, case-insensitively", () => {
  assert.deepEqual(ids("BILL test"), ["acme-test-billing"]);
  assert.deepEqual(ids("billing nope"), []);
});

test("display name is searched", () => {
  assert.deepEqual(ids("sandbox"), ["dev-alice"]);
});

test("limit caps results", () => {
  assert.equal(ids("a", 2).length, 2);
});

test("highlight marks all token occurrences", () => {
  assert.deepEqual(highlight("acme-prod-prod", "prod"), [
    { text: "acme-", hit: false },
    { text: "prod", hit: true },
    { text: "-", hit: false },
    { text: "prod", hit: true },
  ]);
  assert.deepEqual(highlight("abc", ""), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlight("", "x"), []);
});
