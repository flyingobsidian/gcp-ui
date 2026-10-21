// ServicePrefs remembers, per browser, how often each service is used, which
// services are starred, and the last location used for location-scoped
// services. Frequent services are ranked by use count, so the ones used most
// float to the top.

import type { StorageLike } from "./cache.ts";
import { DEFAULT_STARRED, SERVICES, type Service } from "./services.ts";

const KEY = "gcpui:services";
export const MAX_FREQUENT = 12;

// Locations are region or zone names such as "europe-west2" or "us-central1-a".
const LOCATION = /^[a-z][a-z0-9-]{1,62}$/;

export function isValidLocation(s: string): boolean {
  return LOCATION.test(s);
}

interface Saved {
  counts: Record<string, number>;
  lastUsed: Record<string, number>;
  starred: string[];
  locations: Record<string, string>;
}

export class ServicePrefs {
  private data: Saved;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;

  constructor(storage: StorageLike | null, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
    this.data = this.load();
  }

  isStarred(id: string): boolean {
    return this.data.starred.includes(id);
  }

  toggleStar(id: string): void {
    this.data.starred = this.isStarred(id) ? this.data.starred.filter((s) => s !== id) : [...this.data.starred, id];
    this.save();
  }

  recordUse(id: string): void {
    this.data.counts[id] = (this.data.counts[id] ?? 0) + 1;
    this.data.lastUsed[id] = this.now();
    this.save();
  }

  location(id: string): string {
    return this.data.locations[id] ?? "";
  }

  setLocation(id: string, location: string): void {
    if (!isValidLocation(location) || this.data.locations[id] === location) return;
    this.data.locations[id] = location;
    this.save();
  }

  // frequent returns starred and previously used services, most used first;
  // ties go to the more recently used, then starred, then catalogue order.
  frequent(): Service[] {
    const order = new Map(SERVICES.map((s, i) => [s.id, i]));
    const { counts, lastUsed } = this.data;
    return SERVICES
      .filter((s) => this.isStarred(s.id) || (counts[s.id] ?? 0) > 0)
      .sort((a, b) =>
        (counts[b.id] ?? 0) - (counts[a.id] ?? 0) ||
        (lastUsed[b.id] ?? 0) - (lastUsed[a.id] ?? 0) ||
        Number(this.isStarred(b.id)) - Number(this.isStarred(a.id)) ||
        order.get(a.id)! - order.get(b.id)!)
      .slice(0, MAX_FREQUENT);
  }

  private load(): Saved {
    const fresh: Saved = { counts: {}, lastUsed: {}, starred: [...DEFAULT_STARRED], locations: {} };
    const raw = this.storage?.getItem(KEY);
    if (!raw) return fresh;
    try {
      const v = JSON.parse(raw) as Partial<Saved>;
      return {
        counts: typeof v.counts === "object" && v.counts ? v.counts : {},
        lastUsed: typeof v.lastUsed === "object" && v.lastUsed ? v.lastUsed : {},
        starred: Array.isArray(v.starred) ? v.starred.filter((s) => typeof s === "string") : fresh.starred,
        locations: Object.fromEntries(
          Object.entries(typeof v.locations === "object" && v.locations ? v.locations : {})
            .filter((e): e is [string, string] => typeof e[1] === "string" && isValidLocation(e[1]))),
      };
    } catch {
      return fresh;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Preferences are a convenience; losing them is harmless.
    }
  }
}
