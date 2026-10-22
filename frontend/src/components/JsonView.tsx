import type { CellLinker } from "../consoleLinks.ts";
import type { TablePrefs } from "../tablePrefs.ts";
import { DataTable } from "./DataTable.tsx";

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Props {
  value: unknown;
  prefs: TablePrefs;
  table: string;
  project: string;
  linkFor?: CellLinker;
}

// JsonView renders an array of objects as an interactive table of their
// scalar fields, and anything else as pretty-printed JSON.
export function JsonView({ value, prefs, table, project, linkFor }: Props) {
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    const cols: string[] = [];
    for (const row of value) {
      for (const [k, v] of Object.entries(row)) if (isScalar(v) && !cols.includes(k)) cols.push(k);
    }
    return <DataTable rows={value} columns={cols} prefs={prefs} table={table} project={project} linkFor={linkFor} />;
  }
  return <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}
