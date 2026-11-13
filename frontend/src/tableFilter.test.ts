import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText, filterRows, filterTokens } from "./tableFilter.ts";

const rows = [
  { name: "web-1", zone: "europe-west2-a", status: "RUNNING", cpus: 4 },
  { name: "web-2", zone: "us-central1-b", status: "TERMINATED", cpus: 2 },
  { name: "db-1", zone: "europe-west2-b", status: "RUNNING", cpus: 16, hidden: "secretword" },
];
const cols = ["name", "zone", "status", "cpus"];
const names = (q: string) => filterRows(rows, cols, q).map((r) => r.name);

test("empty query keeps every row", () => {
  assert.deepEqual(names(""), ["web-1", "web-2", "db-1"]);
  assert.deepEqual(names("   "), ["web-1", "web-2", "db-1"]);
});

test("matches any column, case-insensitively", () => {
  assert.deepEqual(names("WEB"), ["web-1", "web-2"]);
  assert.deepEqual(names("terminated"), ["web-2"]);
  assert.deepEqual(names("16"), ["db-1"]);
});

test("every token must match, possibly in different columns", () => {
  assert.deepEqual(names("web europe"), ["web-1"]);
  assert.deepEqual(names("running west2-b"), ["db-1"]);
  assert.deepEqual(names("web nowhere"), []);
});

test("tokens do not match across column boundaries or in unsearched columns", () => {
  assert.deepEqual(names("1europe"), []);
  assert.deepEqual(names("secretword"), []);
});

test("helpers", () => {
  assert.deepEqual(filterTokens("  A  b "), ["a", "b"]);
  assert.equal(cellText(null), "");
  assert.equal(cellText(false), "false");
  assert.equal(cellText(0), "0");
});
