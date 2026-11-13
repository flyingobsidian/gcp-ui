import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampWidth, MAX_WIDTH, MIN_WIDTH, moveColumn, nextSort, orderColumns, sortRows, TablePrefs, toggleColumn, visibleColumns,
} from "./tablePrefs.ts";
import type { StorageLike } from "./cache.ts";

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

test("nextSort cycles asc, desc, off; a new column starts asc", () => {
  const a = nextSort(undefined, "name");
  assert.deepEqual(a, { column: "name", dir: "asc" });
  const d = nextSort(a, "name");
  assert.deepEqual(d, { column: "name", dir: "desc" });
  assert.equal(nextSort(d, "name"), undefined);
  assert.deepEqual(nextSort(d, "zone"), { column: "zone", dir: "asc" });
});

test("sortRows: natural, numeric, empties last, stable", () => {
  const rows = [
    { n: "vm-10", c: 3 }, { n: "vm-2", c: 10 }, { n: "", c: 1 }, { n: "VM-1", c: 2 }, { n: "vm-2", c: 0 },
  ];
  assert.deepEqual(sortRows(rows, { column: "n", dir: "asc" }).map((r) => r.n), ["VM-1", "vm-2", "vm-2", "vm-10", ""]);
  assert.deepEqual(sortRows(rows, { column: "n", dir: "desc" }).map((r) => r.n), ["vm-10", "vm-2", "vm-2", "VM-1", ""]);
  assert.deepEqual(sortRows(rows, { column: "n", dir: "asc" }).filter((r) => r.n === "vm-2").map((r) => r.c), [10, 0]);
  assert.deepEqual(sortRows(rows, { column: "c", dir: "asc" }).map((r) => r.c), [0, 1, 2, 3, 10]);
  assert.deepEqual(sortRows(rows, { column: "missing", dir: "desc" }), rows);
  assert.deepEqual(sortRows(rows, undefined), rows);
});

test("orderColumns keeps saved order, appends new columns, drops absent ones", () => {
  assert.deepEqual(orderColumns(["a", "b", "c", "d"], ["c", "x", "a"]), ["c", "a", "b", "d"]);
  assert.deepEqual(orderColumns(["a", "b"], []), ["a", "b"]);
});

test("moveColumn", () => {
  const o = ["a", "b", "c", "d"];
  assert.deepEqual(moveColumn(o, "d", "a", false), ["d", "a", "b", "c"]);
  assert.deepEqual(moveColumn(o, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(moveColumn(o, "a", "a", false), o);
  assert.deepEqual(moveColumn(o, "z", "a", false), o);
});

test("clampWidth", () => {
  assert.equal(clampWidth(1), MIN_WIDTH);
  assert.equal(clampWidth(1e9), MAX_WIDTH);
  assert.equal(clampWidth(123.6), 124);
});

test("sorts are per project and table; layouts per table; both persist", () => {
  const storage = new MemStorage();
  const p = new TablePrefs(storage);
  p.setSort("proj-a", "vms", { column: "zone", dir: "desc" });
  p.setSort("proj-a", "migs", { column: "name", dir: "asc" });
  p.setOrder("vms", ["status", "name"]);
  p.setWidth("vms", "name", 5);

  const again = new TablePrefs(storage);
  assert.deepEqual(again.sort("proj-a", "vms"), { column: "zone", dir: "desc" });
  assert.deepEqual(again.sort("proj-a", "migs"), { column: "name", dir: "asc" });
  assert.equal(again.sort("proj-b", "vms"), undefined);
  assert.deepEqual(again.layout("vms"), { order: ["status", "name"], widths: { name: MIN_WIDTH } });
  assert.deepEqual(again.layout("migs"), { order: [], widths: {} });

  again.setSort("proj-a", "vms", undefined);
  again.resetLayout("vms");
  const third = new TablePrefs(storage);
  assert.equal(third.sort("proj-a", "vms"), undefined);
  assert.deepEqual(third.layout("vms"), { order: [], widths: {} });
  assert.ok(third.sort("proj-a", "migs"), "other tables untouched");
});

test("corrupt or hostile saved prefs are ignored", () => {
  const storage = new MemStorage();
  storage.setItem("gcpui:tables", "{nope");
  assert.equal(new TablePrefs(storage).sort("p", "t"), undefined);
  storage.setItem("gcpui:tables", JSON.stringify({
    sorts: { a: { column: "x", dir: "sideways" }, b: { column: "y", dir: "asc" } },
    layouts: { t: { order: ["a", 7], widths: { a: "wide", b: 99999 } } },
  }));
  const p = new TablePrefs(storage);
  assert.equal(p.sort("", "a"), undefined);
  assert.deepEqual(p.layout("t"), { order: ["a"], widths: { b: MAX_WIDTH } });
});

test("visibleColumns: user choice, then defaults, then everything", () => {
  const ordered = ["name", "zone", "status", "id"];
  assert.deepEqual(visibleColumns(ordered, undefined, undefined), ordered);
  assert.deepEqual(visibleColumns(ordered, undefined, ["status", "name"]), ["name", "status"]);
  assert.deepEqual(visibleColumns(ordered, ["id"], ["status", "name"]), ["id"]);
  assert.deepEqual(visibleColumns(ordered, ["gone"], undefined), ordered, "never show an empty table");
});

test("toggleColumn keeps at least one column", () => {
  assert.deepEqual(toggleColumn(["a", "b"], "b"), ["a"]);
  assert.deepEqual(toggleColumn(["a"], "c"), ["a", "c"]);
  assert.deepEqual(toggleColumn(["a"], "a"), ["a"]);
});

test("visible columns persist and reset with the layout", () => {
  const storage = new MemStorage();
  new TablePrefs(storage).setVisible("vms", ["name", "id"]);
  const p = new TablePrefs(storage);
  assert.deepEqual(p.layout("vms").visible, ["name", "id"]);
  p.resetLayout("vms");
  assert.equal(new TablePrefs(storage).layout("vms").visible, undefined);
});
