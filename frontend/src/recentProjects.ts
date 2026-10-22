// RecentProjects remembers the projects most recently picked, newest first,
// for the project picker's Recent tab.

import type { StorageLike } from "./cache.ts";

const KEY = "gcpui:recentProjects";
export const MAX_RECENT = 15;

// pushRecent moves id to the front of list, keeping at most max entries.
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export class RecentProjects {
  private list: string[];
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.list = this.load();
  }

  get ids(): readonly string[] {
    return this.list;
  }

  add(id: string): void {
    if (!id) return;
    this.list = pushRecent(this.list, id);
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // The recent list is a convenience; losing it is harmless.
    }
  }

  private load(): string[] {
    try {
      const v: unknown = JSON.parse(this.storage?.getItem(KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "").slice(0, MAX_RECENT) : [];
    } catch {
      return [];
    }
  }
}
