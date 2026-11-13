// HierarchyStore loads organizations, folders and projects through the API,
// caching every result (memory + localStorage) and refreshing stale entries
// in the background.

import { SWRCache, type StorageLike } from "./cache.ts";
import {
  parseFolders, parseOrgs, parseProjects,
  type Container, type Folder, type Org, type Project,
} from "./hierarchy.ts";

export interface Loadable<T> {
  status: "loading" | "ok" | "error";
  data?: T;
  error?: string;
  fetchedAt?: number;
  refreshing?: boolean;
}

export interface Children {
  folders: Folder[];
  projects: Project[];
}

export type ListFetcher = (path: string) => Promise<unknown>;

// ORPHANS is the pseudo-container for projects with no visible organization.
export const ORPHANS = "orphans";

const MAX_AGE_MS = 10 * 60 * 1000;
const EXPANDED_KEY = "gcpui:expanded";

export class HierarchyStore {
  orgs: Loadable<Org[]> = { status: "loading" };
  allProjects: Loadable<Project[]> = { status: "loading" };
  readonly children = new Map<string, Loadable<Children>>();
  readonly folders = new Map<string, Folder>();
  expanded: Set<string>;

  private readonly cache: SWRCache;
  private readonly fetchList: ListFetcher;
  private readonly storage: StorageLike | null;
  private readonly errorText: (e: unknown) => string;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  // True until the expanded set is first saved; orgs then start expanded.
  private expandedWasUnset = false;

  constructor(fetchList: ListFetcher, storage: StorageLike | null, errorText: (e: unknown) => string) {
    this.fetchList = fetchList;
    this.storage = storage;
    this.errorText = errorText;
    this.cache = new SWRCache(storage, "gcpui:cache:", MAX_AGE_MS);
    this.expanded = this.loadExpanded();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // snapshot changes whenever the store does; components re-render on it.
  get snapshot(): number {
    return this.version;
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  start(force = false) {
    this.load<Org[]>("orgs", async () => parseOrgs(await this.fetchList("/organizations")), (l) => {
      this.orgs = l;
      if (l.status === "ok" && this.expandedWasUnset) {
        for (const o of l.data ?? []) this.expanded.add(o.key);
        this.expanded.add(ORPHANS);
        this.saveExpanded();
      }
      for (const o of l.data ?? []) if (this.expanded.has(o.key)) this.loadChildren(o, force);
    }, force);
    this.load<Project[]>("projects", async () => parseProjects(await this.fetchList("/projects")), (l) => {
      this.allProjects = l;
    }, force);
    // Folders already expanded from a previous session are reloaded as they
    // become known (see loadChildren).
  }

  refresh() {
    this.cache.clear();
    this.children.clear();
    this.folders.clear();
    this.start(true);
  }

  toggle(node: Container | typeof ORPHANS) {
    const key = typeof node === "string" ? node : node.key;
    if (this.expanded.has(key)) {
      this.expanded.delete(key);
    } else {
      this.expanded.add(key);
      if (typeof node !== "string") this.loadChildren(node);
    }
    this.saveExpanded();
    this.emit();
  }

  // orphanProjects are projects with no parent, or whose organization is not
  // in the visible organizations list.
  orphanProjects(): Project[] {
    const orgKeys = new Set((this.orgs.data ?? []).map((o) => o.key));
    return (this.allProjects.data ?? []).filter((p) => !p.parent || (p.parent.startsWith("organizations/") && !orgKeys.has(p.parent)));
  }

  // pathOf names a project's ancestors as far as they are known, e.g.
  // "example.com / platform / prod".
  pathOf(p: Project): string {
    const names: string[] = [];
    const orgs = this.orgs.data ?? [];
    let key = p.parent;
    for (let depth = 0; key && depth < 20; depth++) {
      const folder = this.folders.get(key);
      if (folder) {
        names.unshift(folder.displayName);
        key = folder.parent;
        continue;
      }
      const org = orgs.find((o) => o.key === key);
      names.unshift(org ? org.displayName : key);
      break;
    }
    return names.join(" / ");
  }

  private loadChildren(c: Container, force = false) {
    const base = c.kind === "org" ? `/organizations/${c.id}` : `/folders/${c.id}`;
    this.load<Children>(`children:${c.key}`, async () => {
      const [folders, projects] = await Promise.all([
        this.fetchList(`${base}/folders`),
        this.fetchList(`${base}/projects`),
      ]);
      return { folders: parseFolders(folders), projects: parseProjects(projects) };
    }, (l) => {
      this.children.set(c.key, l);
      for (const f of l.data?.folders ?? []) {
        this.folders.set(f.key, f);
        if (this.expanded.has(f.key) && !this.children.has(f.key)) this.loadChildren(f, force);
      }
    }, force);
  }

  // load applies cached data immediately (even if stale), then fetches when
  // the entry is missing, stale or force is set.
  private load<T>(key: string, fetcher: () => Promise<T>, apply: (l: Loadable<T>) => void, force: boolean) {
    const cached = this.cache.peek<T>(key);
    const fresh = cached !== undefined && this.cache.isFresh(cached) && !force;
    if (cached) {
      apply({ status: "ok", data: cached.value, fetchedAt: cached.fetchedAt, refreshing: !fresh });
    } else {
      apply({ status: "loading" });
    }
    this.emit();
    if (fresh) return;
    this.cache.fetch(key, fetcher, force).then(
      (e) => apply({ status: "ok", data: e.value, fetchedAt: e.fetchedAt }),
      (err) => apply(cached
        ? { status: "ok", data: cached.value, fetchedAt: cached.fetchedAt, error: this.errorText(err) }
        : { status: "error", error: this.errorText(err) }),
    ).finally(() => this.emit());
  }

  private loadExpanded(): Set<string> {
    const raw = this.storage?.getItem(EXPANDED_KEY);
    if (!raw) {
      this.expandedWasUnset = true;
      return new Set();
    }
    try {
      const keys: unknown = JSON.parse(raw);
      return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : []);
    } catch {
      return new Set();
    }
  }

  private saveExpanded() {
    this.expandedWasUnset = false;
    try {
      this.storage?.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
    } catch {
      // Not critical: the tree just starts collapsed next time.
    }
  }
}
