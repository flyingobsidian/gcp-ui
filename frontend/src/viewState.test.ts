import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closePane, findPane, firstPanePath, formatLayout, MAX_DEPTH, MAX_PANES, pane, paneAt, panesOf, ParseError, parseLayout,
  layoutRects, readView, splitPane, updatePane, withIds, withPane, writeView, type Layout,
} from "./viewState.ts";

const nested = "row(prod-alpha/vms,col:60:40(prod-beta/migs,prod-beta/scheduler@europe-west2))";

test("round trip of nested layouts", () => {
  for (const s of [
    "prod-alpha/vms",
    "prod-alpha",
    "",
    "/buckets",
    nested,
    "col(row(proj-one1/vms,proj-two2/vms),row:1:2:1(proj-a12/buckets,,example.com:legacy-proj/workflows@us-east1))",
  ]) {
    assert.equal(formatLayout(parseLayout(s)), s, s);
  }
});

test("parsed structure", () => {
  assert.deepEqual(parseLayout(nested), {
    kind: "split", dir: "row", children: [
      pane("prod-alpha", "vms"),
      { kind: "split", dir: "col", sizes: [60, 40], children: [pane("prod-beta", "migs"), pane("prod-beta", "scheduler", "europe-west2")] },
    ],
  });
});

test("structural errors are rejected", () => {
  for (const bad of [
    "row(a)", "row(prod-alpha/vms,prod-beta/vms", "row(prod-alpha/vms,prod-beta/vms))", "prod-alpha/vms)",
    "row:1(prod-alpha/vms,prod-beta/vms)", "row:0:1(prod-alpha/vms,prod-beta/vms)", "row:1:2000(prod-alpha/vms,prod-beta/vms)",
    "x".repeat(5000),
  ]) {
    assert.throws(() => parseLayout(bad), ParseError, bad);
  }
  let deep = "proj-leaf1/vms";
  for (let i = 0; i <= MAX_DEPTH; i++) deep = `row(${deep},proj-leaf1/vms)`;
  assert.throws(() => parseLayout(deep), ParseError);
  assert.throws(() => parseLayout(`row(${Array(MAX_PANES + 1).fill("proj-leaf1/vms").join(",")})`), ParseError);
});

test("invalid fields are dropped from the pane, not the layout", () => {
  assert.deepEqual(parseLayout("Bad_Project/vms"), pane("", "vms"));
  assert.deepEqual(parseLayout("prod-alpha/no-such-service"), pane("prod-alpha", ""));
  assert.deepEqual(parseLayout("prod-alpha/scheduler@Not Valid"), pane("prod-alpha", "scheduler"));
  assert.deepEqual(parseLayout("prod-alpha/vms@europe-west2"), pane("prod-alpha", "vms"), "vms takes no location");
  assert.deepEqual(parseLayout("row(prod-alpha/<script>,prod-beta/vms)"),
    { kind: "split", dir: "row", children: [pane("prod-alpha", ""), pane("prod-beta", "vms")] });
});

test("a project starting with row/col is not a split", () => {
  assert.deepEqual(parseLayout("rowan-project/vms"), pane("rowan-project", "vms"));
  assert.deepEqual(parseLayout("collab-proj1"), pane("collab-proj1"));
});

test("readView and writeView", () => {
  const search = `?layout=${nested}&layout=dev-proj1/buckets&active=1`;
  const view = readView(search)!;
  assert.equal(view.layouts.length, 2);
  assert.equal(view.active, 1);
  assert.equal(writeView(view), search);
  assert.equal(writeView({ layouts: [pane("dev-proj1", "vms")], active: 0 }, "?debug=1&layout=old"), "?layout=dev-proj1/vms&debug=1");
  assert.equal(writeView({ layouts: [pane("")], active: 0 }), "", "empty view has no query");
  assert.equal(writeView({ layouts: [pane("")], active: 0 }, "?debug=1"), "?debug=1");
  assert.equal(readView(""), undefined);
  assert.equal(readView("?layout=row(a"), undefined);
  assert.equal(readView("?layout=dev-proj1/vms&active=7")?.active, 0);
  assert.equal(readView("?layout=dev-proj1/vms&active=-1")?.active, 0);
  // Percent-encoded input (e.g. from a mail client) decodes the same.
  assert.deepEqual(readView("?layout=row%28proj-one1%2Fvms%2Cproj-two2%2Fmigs%29")?.layouts[0],
    parseLayout("row(proj-one1/vms,proj-two2/migs)"));
});

test("pane paths", () => {
  const l: Layout = parseLayout(nested);
  assert.deepEqual(firstPanePath(l), [0]);
  assert.deepEqual(paneAt(l, [1, 1]), pane("prod-beta", "scheduler", "europe-west2"));
  assert.equal(paneAt(l, [5]), undefined);
  const changed = withPane(l, [1, 0], pane("prod-gamma", "buckets"));
  assert.equal(formatLayout(changed), "row(prod-alpha/vms,col:60:40(prod-gamma/buckets,prod-beta/scheduler@europe-west2))");
  assert.equal(formatLayout(l), nested, "original untouched");
  assert.deepEqual(withPane(pane("a"), [], pane("prod-alpha", "vms")), pane("prod-alpha", "vms"));
});

test("withIds gives every pane a distinct id, and ids stay out of the URL", () => {
  const l = withIds(parseLayout(nested));
  const ids = panesOf(l).map((p) => p.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every(Boolean));
  assert.equal(formatLayout(l), nested);
  assert.deepEqual(panesOf(withIds(l)).map((p) => p.id), ids);
});

test("splitPane copies the pane beside or below it", () => {
  const one = { ...pane("prod-alpha", "scheduler", "europe-west2"), id: "a" };
  const cols = splitPane(one, "a", "row", "b");
  assert.equal(formatLayout(cols), "row(prod-alpha/scheduler@europe-west2,prod-alpha/scheduler@europe-west2)");
  assert.deepEqual(panesOf(cols).map((p) => p.id), ["a", "b"]);
  const nestedSplit = splitPane(cols, "b", "col", "c");
  assert.equal(formatLayout(nestedSplit),
    "row(prod-alpha/scheduler@europe-west2,col(prod-alpha/scheduler@europe-west2,prod-alpha/scheduler@europe-west2))");
  assert.equal(formatLayout(splitPane(cols, "zzz", "row", "d")), formatLayout(cols), "unknown id: unchanged");
});

test("closePane removes a pane and collapses single-child splits", () => {
  let l: Layout = { ...pane("prod-alpha", "vms"), id: "a" };
  l = splitPane(l, "a", "row", "b");
  l = splitPane(l, "b", "col", "c");
  l = updatePane(l, "c", (p) => ({ ...p, service: "migs" }));
  assert.equal(formatLayout(l), "row(prod-alpha/vms,col(prod-alpha/vms,prod-alpha/migs))");
  const noB = closePane(l, "b");
  assert.equal(formatLayout(noB), "row(prod-alpha/vms,prod-alpha/migs)");
  const onlyC = closePane(noB, "a");
  assert.equal(onlyC.kind, "pane");
  assert.equal(findPane(onlyC, "c")?.service, "migs");
  assert.equal(closePane(onlyC, "c"), onlyC, "the last pane stays");
});

test("closePane keeps the remaining sizes", () => {
  const l = withIds(parseLayout("row:1:2:3(proj-one1,proj-two2,proj-three)"));
  const second = panesOf(l)[1]!.id!;
  assert.equal(formatLayout(closePane(l, second)), "row:1:3(proj-one1,proj-three)");
});

test("layoutRects", () => {
  const r = layoutRects(parseLayout("row:1:3(proj-one1,col(proj-two2,proj-three))"));
  const fmt = r.map((x) => [x.pane.project, x.x, x.y, x.w, x.h].join(" "));
  assert.deepEqual(fmt, ["proj-one1 0 0 0.25 1", "proj-two2 0.25 0 0.75 0.5", "proj-three 0.25 0.5 0.75 0.5"]);
  assert.deepEqual(layoutRects(pane("p")).map((x) => [x.x, x.y, x.w, x.h]), [[0, 0, 1, 1]]);
});
