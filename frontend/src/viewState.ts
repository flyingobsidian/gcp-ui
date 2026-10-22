// View state: one or more layouts (one per window/tab), each a tree of
// splits whose leaves are panes showing a project + object type. It is
// encoded into the URL query so a page can be reloaded or shared.
//
//   ?layout=row(prod-a/vms,col:60:40(prod-b/migs,prod-b/scheduler@europe-west2))&layout=dev-x/buckets&active=1
//
//   layout := split | pane
//   split  := ("row" | "col") (":" size)* "(" layout ("," layout)+ ")"
//   pane   := [project] ["/" [service] ["@" location]]
//
// row places children side by side, col stacks them; sizes are relative
// weights, one per child. Every character used is legal unescaped in a URL
// query, and all values are validated, so the URL stays readable.

import { isValidLocation, serviceById } from "./services.ts";

export interface Pane {
  kind: "pane";
  project: string;
  service: string;
  location: string;
}

export interface Split {
  kind: "split";
  dir: "row" | "col";
  children: Layout[];
  // sizes are relative weights, one per child; undefined means equal.
  sizes?: number[];
}

export type Layout = Pane | Split;

export interface ViewState {
  layouts: Layout[];
  active: number;
}

export const MAX_DEPTH = 8;
export const MAX_PANES = 32;
export const MAX_LAYOUTS = 16;
const MAX_LENGTH = 4000;
const MAX_SIZE = 1000;

const PROJECT = /^([a-z][a-z0-9.-]*[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export const emptyPane = (): Pane => ({ kind: "pane", project: "", service: "", location: "" });

export function pane(project: string, service = "", location = ""): Pane {
  return { kind: "pane", project, service, location };
}

export class ParseError extends Error {}

// parseLayout parses one encoded layout. Structural errors throw ParseError;
// an invalid project, unknown service or bad location is dropped from its
// pane rather than failing the whole layout, so old links degrade gently.
export function parseLayout(text: string): Layout {
  if (text.length > MAX_LENGTH) throw new ParseError("layout too long");
  let pos = 0;
  let panes = 0;

  const parse = (depth: number): Layout => {
    if (depth > MAX_DEPTH) throw new ParseError("layout nested too deeply");
    const m = /^(row|col)((?::\d+)*)\(/.exec(text.slice(pos));
    if (m) {
      pos += m[0].length;
      const children: Layout[] = [parse(depth + 1)];
      while (text[pos] === ",") {
        pos++;
        children.push(parse(depth + 1));
      }
      if (text[pos] !== ")") throw new ParseError(`expected ")" at ${pos}`);
      pos++;
      if (children.length < 2) throw new ParseError("a split needs at least two children");
      const sizes = m[2] ? m[2].slice(1).split(":").map(Number) : undefined;
      if (sizes && (sizes.length !== children.length || sizes.some((s) => s < 1 || s > MAX_SIZE))) {
        throw new ParseError("split sizes must be 1-1000, one per child");
      }
      return sizes ? { kind: "split", dir: m[1] as "row" | "col", children, sizes } : { kind: "split", dir: m[1] as "row" | "col", children };
    }
    const end = text.slice(pos).search(/[,()]/);
    const raw = end === -1 ? text.slice(pos) : text.slice(pos, pos + end);
    pos += raw.length;
    if (++panes > MAX_PANES) throw new ParseError("too many panes");
    return parsePane(raw);
  };

  const layout = parse(0);
  if (pos !== text.length) throw new ParseError(`unexpected "${text[pos]}" at ${pos}`);
  return layout;
}

function parsePane(raw: string): Pane {
  const slash = raw.indexOf("/");
  const project = slash === -1 ? raw : raw.slice(0, slash);
  const rest = slash === -1 ? "" : raw.slice(slash + 1);
  const at = rest.indexOf("@");
  const service = at === -1 ? rest : rest.slice(0, at);
  const location = at === -1 ? "" : rest.slice(at + 1);
  const svc = serviceById(service);
  return pane(
    PROJECT.test(project) ? project : "",
    svc ? service : "",
    svc?.locationFlag && isValidLocation(location) ? location : "",
  );
}

export function formatLayout(layout: Layout): string {
  if (layout.kind === "split") {
    const sizes = layout.sizes ? layout.sizes.map((s) => `:${s}`).join("") : "";
    return `${layout.dir}${sizes}(${layout.children.map(formatLayout).join(",")})`;
  }
  let s = layout.project;
  if (layout.service) s += `/${layout.service}${layout.location ? `@${layout.location}` : ""}`;
  return s;
}

// readView parses a URL query string ("?layout=…&active=…"). It returns
// undefined when there is no layout or it cannot be parsed.
export function readView(search: string): ViewState | undefined {
  const params = new URLSearchParams(search);
  const encoded = params.getAll("layout").slice(0, MAX_LAYOUTS);
  if (encoded.length === 0) return undefined;
  try {
    const layouts = encoded.map(parseLayout);
    const active = Number(params.get("active") ?? 0);
    return { layouts, active: Number.isInteger(active) && active >= 0 && active < layouts.length ? active : 0 };
  } catch (err) {
    if (err instanceof ParseError) return undefined;
    throw err;
  }
}

// writeView returns the query string for view, keeping any other params in
// base. Values are appended unescaped: every character formatLayout emits is
// valid in a query and none of them is "&", "=", "+", "#" or "%".
export function writeView(view: ViewState, base = ""): string {
  const params = new URLSearchParams(base);
  params.delete("layout");
  params.delete("active");
  const parts = view.layouts.map((l) => `layout=${formatLayout(l)}`);
  if (view.active > 0) parts.push(`active=${view.active}`);
  const other = params.toString();
  return `?${[...parts, ...(other ? [other] : [])].join("&")}`;
}

// A PanePath addresses a pane by child indexes from the layout root.
export type PanePath = number[];

export function firstPanePath(layout: Layout): PanePath {
  return layout.kind === "pane" ? [] : [0, ...firstPanePath(layout.children[0]!)];
}

export function paneAt(layout: Layout, path: PanePath): Pane | undefined {
  let node: Layout | undefined = layout;
  for (const i of path) node = node?.kind === "split" ? node.children[i] : undefined;
  return node?.kind === "pane" ? node : undefined;
}

// withPane returns layout with the pane at path replaced.
export function withPane(layout: Layout, path: PanePath, p: Pane): Layout {
  if (path.length === 0) return p;
  if (layout.kind !== "split") return layout;
  const [i, ...rest] = path;
  return { ...layout, children: layout.children.map((c, j) => (j === i ? withPane(c, rest, p) : c)) };
}

export function samePane(a: Pane | undefined, b: Pane | undefined): boolean {
  return !!a && !!b && a.project === b.project && a.service === b.service && a.location === b.location;
}
