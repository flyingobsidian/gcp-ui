import { test } from "node:test";
import assert from "node:assert/strict";
import { parentKey, parseFolders, parseOrgs, parseProjects } from "./hierarchy.ts";

test("parentKey handles v3 strings and v1 objects", () => {
  assert.equal(parentKey("folders/12"), "folders/12");
  assert.equal(parentKey({ type: "folder", id: "12" }), "folders/12");
  assert.equal(parentKey({ type: "organization", id: 34 }), "organizations/34");
  assert.equal(parentKey({ type: "folder" }), "");
  assert.equal(parentKey(undefined), "");
  assert.equal(parentKey(null), "");
});

test("parseOrgs", () => {
  const orgs = parseOrgs([
    { name: "organizations/2", displayName: "zeta.example" },
    { name: "organizations/1", displayName: "alpha.example" },
    { name: "bogus" },
    "not an object",
  ]);
  assert.deepEqual(orgs.map((o) => [o.id, o.displayName]), [["1", "alpha.example"], ["2", "zeta.example"]]);
});

test("parseFolders sorts naturally and keeps parent", () => {
  const folders = parseFolders([
    { name: "folders/3", displayName: "team-10", parent: "organizations/1" },
    { name: "folders/2", displayName: "team-9", parent: "organizations/1" },
  ]);
  assert.deepEqual(folders.map((f) => f.displayName), ["team-9", "team-10"]);
  assert.equal(folders[0]?.parent, "organizations/1");
});

test("parseProjects accepts v3 (gcloud-go) shape", () => {
  const [p] = parseProjects([
    { projectId: "my-proj", displayName: "My Project", name: "projects/123", parent: "folders/9", state: "ACTIVE" },
  ]);
  assert.deepEqual(p, {
    kind: "project", key: "projects/my-proj", projectId: "my-proj", displayName: "My Project", number: "123", parent: "folders/9",
  });
});

test("parseProjects accepts v1 (Python gcloud) shape", () => {
  const [p] = parseProjects([
    { projectId: "my-proj", name: "My Project", projectNumber: "123", parent: { type: "organization", id: "1" } },
  ]);
  assert.equal(p?.displayName, "My Project");
  assert.equal(p?.number, "123");
  assert.equal(p?.parent, "organizations/1");
});

test("parseProjects falls back to projectId and skips junk", () => {
  const ps = parseProjects([{ projectId: "b-proj", name: "projects/2" }, { name: "no id" }, null, { projectId: "a-proj" }]);
  assert.deepEqual(ps.map((p) => [p.projectId, p.displayName, p.parent]), [["a-proj", "a-proj", ""], ["b-proj", "b-proj", ""]]);
});

test("parseProjects sorts naturally", () => {
  const ps = parseProjects([{ projectId: "svc10" }, { projectId: "svc2" }, { projectId: "svc1" }]);
  assert.deepEqual(ps.map((p) => p.projectId), ["svc1", "svc2", "svc10"]);
});

test("parsers tolerate non-arrays", () => {
  assert.deepEqual(parseOrgs(null), []);
  assert.deepEqual(parseFolders({}), []);
  assert.deepEqual(parseProjects("x"), []);
});
