// Links from list rows to the Google Cloud console. Each catalogue service
// may name the columns that become links and how to build the console URL
// from a row of its `gcloud … list --format=json` output.
//
// Rows are untrusted data: every value taken from a row is reduced to a single
// path segment and URI-encoded, so it cannot change the URL's host or path
// structure.

type Row = Record<string, unknown>;

export interface LinkSpec {
  // columns whose cells become links.
  columns: readonly string[];
  url: (row: Row, project: string) => string | undefined;
}

export const CONSOLE = "https://console.cloud.google.com";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// lastSegment returns the final path segment of a value such as
// "https://www.googleapis.com/compute/v1/projects/p/zones/europe-west2-a" or a
// bare "europe-west2-a".
export function lastSegment(v: unknown): string {
  const parts = str(v).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// resourceSegment returns the segment following key in a resource name, e.g.
// resourceSegment("projects/p/locations/l/jobs/j", "locations") === "l".
export function resourceSegment(name: unknown, key: string): string {
  const parts = str(name).split("/");
  const i = parts.indexOf(key);
  return i >= 0 ? parts[i + 1] ?? "" : "";
}

// consoleUrl joins fixed path and per-row segments; it returns undefined when
// any per-row segment is missing.
export function consoleUrl(path: string, segments: readonly string[], project: string, query: Record<string, string> = {}): string | undefined {
  if (!project || segments.some((s) => !s)) return undefined;
  const params = new URLSearchParams({ project, ...query });
  const tail = segments.map(encodeURIComponent).join("/");
  return `${CONSOLE}/${path}${tail ? `/${tail}` : ""}?${params}`;
}

export const CONSOLE_LINKS: Readonly<Record<string, LinkSpec>> = {
  migs: {
    columns: ["name", "baseInstanceName"],
    url: (r, p) => consoleUrl("compute/instanceGroups/details",
      [lastSegment(r["region"]) || lastSegment(r["zone"]), str(r["name"])], p, { tab: "overview" }),
  },
  vms: {
    columns: ["name"],
    url: (r, p) => consoleUrl("compute/instancesDetail/zones", [lastSegment(r["zone"]), "instances", str(r["name"])], p),
  },
  buckets: {
    columns: ["name"],
    url: (r, p) => consoleUrl("storage/browser", [str(r["name"]) || lastSegment(r["storage_url"])], p),
  },
  scheduler: {
    columns: ["name"],
    url: (r, p) => consoleUrl("cloudscheduler/jobs/edit",
      [resourceSegment(r["name"], "locations"), resourceSegment(r["name"], "jobs")], p),
  },
  workflows: {
    columns: ["name"],
    url: (r, p) => {
      const loc = resourceSegment(r["name"], "locations");
      const wf = resourceSegment(r["name"], "workflows");
      return consoleUrl("workflows/workflow", [loc, wf, "executions"], p);
    },
  },
  sql: {
    columns: ["name"],
    url: (r, p) => consoleUrl("sql/instances", [str(r["name"]), "overview"], p),
  },
  "gke-clusters": {
    columns: ["name"],
    url: (r, p) => consoleUrl("kubernetes/clusters/details",
      [lastSegment(r["location"]) || lastSegment(r["zone"]), str(r["name"]), "details"], p),
  },
  "pubsub-topics": {
    columns: ["name"],
    url: (r, p) => consoleUrl("cloudpubsub/topic/detail", [resourceSegment(r["name"], "topics")], p),
  },
  "pubsub-subscriptions": {
    columns: ["name"],
    url: (r, p) => consoleUrl("cloudpubsub/subscription/detail", [resourceSegment(r["name"], "subscriptions")], p),
  },
  secrets: {
    columns: ["name"],
    url: (r, p) => consoleUrl("security/secret-manager/secret", [resourceSegment(r["name"], "secrets"), "versions"], p),
  },
};

export type CellLinker = (row: Row, column: string) => string | undefined;

// linkerFor returns a function giving the console URL for a table cell, or
// undefined when the service has no console links.
export function linkerFor(serviceId: string | undefined, project: string): CellLinker | undefined {
  const spec = serviceId ? CONSOLE_LINKS[serviceId] : undefined;
  if (!spec || !project) return undefined;
  return (row, column) => (spec.columns.includes(column) ? spec.url(row, project) : undefined);
}
