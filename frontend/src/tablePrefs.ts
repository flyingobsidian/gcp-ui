// TablePrefs remembers how the user arranged each results table: the sort
// (per project and table, so VMs in one project can sort differently from
// VMs in another) and the column order and widths (per table, shared by all
// projects).

import type { StorageLike } from "./cache.ts";
import { naturalCompare } from "./hierarchy.ts";

export type SortDir = "asc" | "desc";

export interface Sort {
  column: string;
  dir: SortDir;
}

export interface Layout {
  order: string[];
  widths: Record<string, number>;
}

interface Saved {
  sorts: Record<string, Sort>;
  layouts: Record<string, Layout>;
}

const KEY = "gcpui:tables";
export const MIN_WIDTH = 40;
export const MAX_WIDTH = 2000;

const sortKey = (project: string, table: string) => `${project}\u0000${table}`;

export class TablePrefs {
  private data: Saved;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.data = this.load();
  }

  sort(project: string, table: string): Sort | undefined {
    return this.data.sorts[sortKey(project, table)];
  }

  setSort(project: string, table: string, sort: Sort | undefined): void {
    const k = sortKey(project, table);
    if (sort) this.data.sorts[k] = sort;
    else delete this.data.sorts[k];
    this.save();
  }

  layout(table: string): Layout {
    return this.data.layouts[table] ?? { order: [], widths: {} };
  }

  setOrder(table: string, order: string[]): void {
    this.data.layouts[table] = { ...this.layout(table), order };
    this.save();
  }

  setWidth(table: string, column: string, width: number): void {
    const l = this.layout(table);
    this.data.layouts[table] = { ...l, widths: { ...l.widths, [column]: clampWidth(width) } };
    this.save();
  }

  // resetLayout forgets column order and widths for table (not its sorts).
  resetLayout(table: string): void {
    delete this.data.layouts[table];
    this.save();
  }

  private load(): Saved {
    const empty: Saved = { sorts: {}, layouts: {} };
    const raw = this.storage?.getItem(KEY);
    if (!raw) return empty;
    try {
      const v = JSON.parse(raw) as Partial<Saved>;
      const sorts: Record<string, Sort> = {};
      for (const [k, s] of Object.entries(isObject(v.sorts) ? v.sorts : {})) {
        if (isObject(s) && typeof s.column === "string" && (s.dir === "asc" || s.dir === "desc")) sorts[k] = { column: s.column, dir: s.dir };
      }
      const layouts: Record<string, Layout> = {};
      for (const [k, l] of Object.entries(isObject(v.layouts) ? v.layouts : {})) {
        if (!isObject(l)) continue;
        const order = Array.isArray(l.order) ? l.order.filter((c): c is string => typeof c === "string") : [];
        const widths: Record<string, number> = {};
        for (const [c, w] of Object.entries(isObject(l.widths) ? l.widths : {})) {
          if (typeof w === "number" && Number.isFinite(w)) widths[c] = clampWidth(w);
        }
        layouts[k] = { order, widths };
      }
      return { sorts, layouts };
    } catch {
      return empty;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Table preferences are a convenience; losing them is harmless.
    }
  }
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export function clampWidth(w: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
}

// orderColumns applies a saved order to the columns found in the data:
// saved columns first in saved order, then any new columns in data order.
// Saved columns absent from this data are skipped.
export function orderColumns(found: readonly string[], saved: readonly string[]): string[] {
  const present = new Set(found);
  const head = saved.filter((c) => present.has(c));
  const seen = new Set(head);
  return [...head, ...found.filter((c) => !seen.has(c))];
}

// moveColumn moves column from to sit before (or after) column to.
export function moveColumn(order: readonly string[], from: string, to: string, after: boolean): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return [...order];
  const rest = order.filter((c) => c !== from);
  const i = rest.indexOf(to) + (after ? 1 : 0);
  return [...rest.slice(0, i), from, ...rest.slice(i)];
}

// nextSort cycles a header click: unsorted → ascending → descending → unsorted.
export function nextSort(current: Sort | undefined, column: string): Sort | undefined {
  if (!current || current.column !== column) return { column, dir: "asc" };
  return current.dir === "asc" ? { column, dir: "desc" } : undefined;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

// compareValues orders numbers numerically and everything else as natural
// text ("vm-2" before "vm-10"), case-insensitively.
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return naturalCompare(String(a), String(b));
}

// sortRows returns a sorted copy; empty values always go last, and ties keep
// their original order.
export function sortRows<T extends Record<string, unknown>>(rows: readonly T[], sort: Sort | undefined): T[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[sort.column];
      const b = y.row[sort.column];
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea || eb) return ea === eb ? x.i - y.i : ea ? 1 : -1;
      return sign * compareValues(a, b) || x.i - y.i;
    })
    .map((x) => x.row);
}
