// splitArgs splits a command line on whitespace, honouring '…' and "…" quoting.
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let inArg = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inArg = true;
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(cur);
      cur = "";
      inArg = false;
    } else {
      cur += ch;
      inArg = true;
    }
  }
  if (quote) throw new Error("unterminated quote");
  if (inArg) args.push(cur);
  return args;
}
