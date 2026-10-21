import type { CellLinker } from "../consoleLinks.ts";

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// JsonView renders an array of objects as a table of their scalar fields,
// and anything else as pretty-printed JSON. linkFor, when given, turns cells
// into links to the Google Cloud console (opened in a new tab).
export function JsonView({ value, linkFor }: { value: unknown; linkFor?: CellLinker }) {
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    const cols: string[] = [];
    for (const row of value) {
      for (const [k, v] of Object.entries(row)) if (isScalar(v) && !cols.includes(k)) cols.push(k);
    }
    return (
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {value.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const text = String(row[c] ?? "");
                const href = text ? linkFor?.(row, c) : undefined;
                return (
                  <td key={c}>
                    {href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" title="Open in Google Cloud console">{text}</a>
                      : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}
