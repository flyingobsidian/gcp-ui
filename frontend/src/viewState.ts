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
  // id identifies the pane on screen while the page is open (e.g. as a
  // render key, so splitting a pane keeps the others' state). It is not
  // part of the URL.
  id?: string;
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
  // A single empty pane is the default view, so it needs no parameter.
  const empty = view.layouts.length === 1 && formatLayout(view.layouts[0]!) === "";
  const parts = empty ? [] : view.layouts.map((l) => `layout=${formatLayout(l)}`);
  if (!empty && view.active > 0) parts.push(`active=${view.active}`);
  const other = params.toString();
  if (other) parts.push(other);
  return parts.length ? `?${parts.join("&")}` : "";
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

let lastPaneId = 0;

export function newPaneId(): string {
  return `pane-${++lastPaneId}`;
}

// withIds gives every pane in layout an id.
export function withIds(layout: Layout): Layout {
  if (layout.kind === "pane") return layout.id ? layout : { ...layout, id: newPaneId() };
  return { ...layout, children: layout.children.map(withIds) };
}

export function panesOf(layout: Layout): Pane[] {
  return layout.kind === "pane" ? [layout] : layout.children.flatMap(panesOf);
}

export function findPane(layout: Layout, id: string): Pane | undefined {
  return panesOf(layout).find((p) => p.id === id);
}

// updatePane returns layout with pane id replaced by f(pane).
export function updatePane(layout: Layout, id: string, f: (p: Pane) => Pane): Layout {
  if (layout.kind === "pane") return layout.id === id ? f(layout) : layout;
  return { ...layout, children: layout.children.map((c) => updatePane(c, id, f)) };
}

// splitPane replaces pane id with a split holding it and a copy (same
// project, service and location) with id newId; "row" puts the copy to the
// right, "col" below.
export function splitPane(layout: Layout, id: string, dir: "row" | "col", newId: string): Layout {
  return replaceNode(layout, id, (p) => ({ kind: "split", dir, children: [p, { ...p, id: newId }] }));
}

function replaceNode(layout: Layout, id: string, f: (p: Pane) => Layout): Layout {
  if (layout.kind === "pane") return layout.id === id ? f(layout) : layout;
  return { ...layout, children: layout.children.map((c) => replaceNode(c, id, f)) };
}

// closePane removes pane id. A split left with one child is replaced by that
// child. The last remaining pane cannot be closed: layout is returned as is.
export function closePane(layout: Layout, id: string): Layout {
  if (layout.kind === "pane") return layout;
  const i = layout.children.findIndex((c) => c.kind === "pane" && c.id === id);
  if (i === -1) return { ...layout, children: layout.children.map((c) => closePane(c, id)) };
  const children = layout.children.filter((_, j) => j !== i);
  if (children.length === 1) return children[0]!;
  const sizes = layout.sizes?.filter((_, j) => j !== i);
  return sizes ? { ...layout, children, sizes } : { kind: "split", dir: layout.dir, children };
}

export interface PaneRect {
  pane: Pane;
  // x, y, w, h are fractions (0-1) of the whole layout area.
  x: number;
  y: number;
  w: number;
  h: number;
}

// layoutRects places every pane: a row split divides its width among its
// children by their size weights, a col split divides its height.
export function layoutRects(layout: Layout, x = 0, y = 0, w = 1, h = 1): PaneRect[] {
  if (layout.kind === "pane") return [{ pane: layout, x, y, w, h }];
  const weights = layout.sizes ?? layout.children.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: PaneRect[] = [];
  let offset = 0;
  layout.children.forEach((child, i) => {
    const share = weights[i]! / total;
    if (layout.dir === "row") out.push(...layoutRects(child, x + offset * w, y, share * w, h));
    else out.push(...layoutRects(child, x, y + offset * h, w, share * h));
    offset += share;
  });
  return out;
}
