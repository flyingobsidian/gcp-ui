// A stale-while-revalidate cache backed by memory and (optionally) a
// persistent Storage such as localStorage, so the picker paints instantly from
// the last known data and refreshes in the background.

export interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export class SWRCache {
  private readonly memory = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly storage: StorageLike | null;
  private readonly prefix: string;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(storage: StorageLike | null, prefix: string, maxAgeMs: number, now: () => number = Date.now) {
    this.storage = storage;
    this.prefix = prefix;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  peek<T>(key: string): Entry<T> | undefined {
    const hit = this.memory.get(key);
    if (hit) return hit as Entry<T>;
    const raw = this.storage?.getItem(this.prefix + key);
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as Entry<T>;
      if (typeof entry.fetchedAt !== "number") return undefined;
      this.memory.set(key, entry);
      return entry;
    } catch {
      this.storage?.removeItem(this.prefix + key);
      return undefined;
    }
  }

  isFresh(entry: Entry<unknown>): boolean {
    return this.now() - entry.fetchedAt < this.maxAgeMs;
  }

  set<T>(key: string, value: T): Entry<T> {
    const entry: Entry<T> = { value, fetchedAt: this.now() };
    this.memory.set(key, entry);
    try {
      this.storage?.setItem(this.prefix + key, JSON.stringify(entry));
    } catch {
      // Storage full or unavailable: the in-memory copy is still good.
    }
    return entry;
  }

  // fetch returns the cached value when fresh; otherwise it calls fetcher,
  // de-duplicating concurrent calls for the same key.
  fetch<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<Entry<T>> {
    const cached = this.peek<T>(key);
    if (!force && cached && this.isFresh(cached)) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<Entry<T>>;
    const p = fetcher()
      .then((v) => this.set(key, v))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.memory.clear();
    if (!this.storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k?.startsWith(this.prefix)) doomed.push(k);
    }
    for (const k of doomed) this.storage.removeItem(k);
  }
}
