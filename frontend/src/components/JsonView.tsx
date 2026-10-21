const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// JsonView renders an array of objects as a table of their scalar fields,
// and anything else as pretty-printed JSON.
export function JsonView({ value }: { value: unknown }) {
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
            <tr key={i}>{cols.map((c) => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}
