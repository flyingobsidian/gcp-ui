// Per-service table presentation: which columns show by default, how raw
// gcloud values are shortened for display, and per-row actions.

import { lastSegment } from "./consoleLinks.ts";

type Row = Record<string, unknown>;

export interface RowAction {
  icon: string;
  title: string;
  // copyText returns the text to put on the clipboard, or undefined when the
  // row lacks what the action needs.
  copyText: (row: Row, project: string) => string | undefined;
}

export interface TableDefaults {
  // columns shown, in this order, until the user changes them.
  columns: readonly string[];
  // display replaces or adds column values; it receives the raw row.
  display?: Readonly<Record<string, (row: Row) => unknown>>;
  // actions are shown next to the value in the given column.
  actions?: Readonly<Record<string, readonly RowAction[]>>;
}

// regionOf gives a resource's region: its region, or the region containing
// its zone ("europe-west2-b" → "europe-west2").
export function regionOf(row: Row): string {
  const region = lastSegment(row["region"]);
  if (region) return region;
  const zone = lastSegment(row["zone"]);
  return /^[a-z]+-[a-z]+\d+-[a-z]$/.test(zone) ? zone.slice(0, zone.lastIndexOf("-")) : zone;
}

// Names, zones and project IDs that are safe to paste into a shell unquoted.
const SHELL_SAFE = /^[a-z0-9][a-z0-9.:-]*$/;

export function sshCommand(row: Row, project: string): string | undefined {
  const name = typeof row["name"] === "string" ? row["name"] : "";
  const zone = lastSegment(row["zone"]);
  if (![name, zone, project].every((v) => SHELL_SAFE.test(v))) return undefined;
  return `gcloud compute ssh --zone ${zone} --tunnel-through-iap --project ${project} ${name}`;
}

export const TABLE_DEFAULTS: Readonly<Record<string, TableDefaults>> = {
  vms: {
    columns: ["name", "zone", "status"],
    display: {
      zone: (r) => lastSegment(r["zone"]),
      machineType: (r) => lastSegment(r["machineType"]),
    },
    actions: {
      name: [{ icon: "⌨", title: "Copy gcloud compute ssh command (IAP tunnel)", copyText: sshCommand }],
    },
  },
  migs: {
    columns: ["name", "region", "size", "targetSize"],
    display: {
      region: regionOf,
      zone: (r) => lastSegment(r["zone"]),
      instanceTemplate: (r) => lastSegment(r["instanceTemplate"]),
    },
  },
  scheduler: {
    columns: ["name", "schedule", "state", "description"],
    display: { name: (r) => lastSegment(r["name"]) },
  },
};

export function defaultsFor(table: string): TableDefaults | undefined {
  return TABLE_DEFAULTS[table];
}

// displayColumns lists the columns a table can show: those found in the data
// plus any computed by the defaults (e.g. MIG region), defaults first.
export function displayColumns(found: readonly string[], d: TableDefaults | undefined): string[] {
  const extra = Object.keys(d?.display ?? {}).filter((c) => !found.includes(c) && (d?.columns.includes(c) ?? false));
  return [...found, ...extra];
}

// displayRow returns the row as shown: raw values with display overrides
// applied. Sorting and filtering work on these values.
export function displayRow(row: Row, d: TableDefaults | undefined): Row {
  if (!d?.display) return row;
  const out: Row = { ...row };
  for (const [c, f] of Object.entries(d.display)) {
    if (c in row || d.columns.includes(c)) out[c] = f(row);
  }
  return out;
}
