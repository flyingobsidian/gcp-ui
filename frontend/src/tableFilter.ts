// Client-side row filtering for result tables.

type Row = Record<string, unknown>;

export function filterTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function cellText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

// filterRows keeps rows in which every whitespace-separated token of query
// appears (case-insensitively) in at least one of columns. Different tokens
// may match different columns, so "web europe" finds a VM named web-1 in an
// europe-west2 zone.
export function filterRows<T extends Row>(rows: readonly T[], columns: readonly string[], query: string): T[] {
  const tokens = filterTokens(query);
  if (tokens.length === 0) return [...rows];
  return rows.filter((row) => {
    const hay = columns.map((c) => cellText(row[c]).toLowerCase()).join("\u0000");
    return tokens.every((t) => hay.includes(t));
  });
}
