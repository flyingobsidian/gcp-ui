// ResultCache keeps recent gcloud results so switching between tables
// (project or service) can show them without re-running gcloud. Entries live
// in memory and in localStorage; the oldest are evicted beyond MAX_ENTRIES.

import type { RunResponse } from "./api.ts";
import type { StorageLike } from "./cache.ts";

// RESULT_MAX_AGE_MS is how long a cached result is shown instead of
// re-running gcloud when switching tables. The Run button always re-runs.
export const RESULT_MAX_AGE_MS = 3600 * 1000;
export const MAX_ENTRIES = 100;

const KEY = "gcpui:results";

export interface CachedResult {
  response: RunResponse;
  fetchedAt: number;
}

export function resultKey(project: string, args: readonly string[]): string {
  return JSON.stringify([project, ...args]);
}

export class ResultCache {
  private entries: Map<string, CachedResult>;
  private readonly storage: StorageLike | null;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(storage: StorageLike | null, maxAgeMs = RESULT_MAX_AGE_MS, now: () => number = Date.now) {
    this.storage = storage;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.entries = this.load();
  }

  // fresh returns the cached result if it is younger than the maximum age.
  fresh(project: string, args: readonly string[]): CachedResult | undefined {
    const e = this.entries.get(resultKey(project, args));
    return e && this.now() - e.fetchedAt < this.maxAgeMs ? e : undefined;
  }

  put(project: string, args: readonly string[], response: RunResponse): void {
    const k = resultKey(project, args);
    this.entries.delete(k); // re-insert so Map order is oldest-first
    this.entries.set(k, { response, fetchedAt: this.now() });
    for (const old of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(old);
    }
    this.save();
  }

  private load(): Map<string, CachedResult> {
    const out = new Map<string, CachedResult>();
    const raw = this.storage?.getItem(KEY);
    if (!raw) return out;
    try {
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list)) return out;
      for (const item of list) {
        if (!Array.isArray(item) || typeof item[0] !== "string") continue;
        const e = item[1] as Partial<CachedResult> | undefined;
        if (e && typeof e.fetchedAt === "number" && typeof e.response === "object" && e.response) {
          out.set(item[0], { response: e.response, fetchedAt: e.fetchedAt });
        }
      }
    } catch {
      // Corrupt cache: start empty.
    }
    return out;
  }

  // save persists entries, dropping the oldest half and retrying if storage
  // is full.
  private save(): void {
    if (!this.storage) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        this.storage.setItem(KEY, JSON.stringify([...this.entries]));
        return;
      } catch {
        const keys = [...this.entries.keys()];
        for (const k of keys.slice(0, Math.ceil(keys.length / 2))) this.entries.delete(k);
      }
    }
  }
}

// ageText renders an age such as "just now", "4 min ago" or "1 h 5 min ago".
export function ageText(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min ago` : `${h} h ago`;
}
