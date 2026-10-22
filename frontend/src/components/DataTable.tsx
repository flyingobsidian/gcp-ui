import { useRef, useState } from "preact/hooks";
import type { CellLinker } from "../consoleLinks.ts";
import { clampWidth, moveColumn, nextSort, orderColumns, sortRows, type TablePrefs } from "../tablePrefs.ts";

type Row = Record<string, unknown>;

interface Props {
  rows: Row[];
  columns: string[];
  prefs: TablePrefs;
  // table identifies the kind of table (e.g. the catalogue service) for
  // remembered layout; project scopes the remembered sort.
  table: string;
  project: string;
  linkFor?: CellLinker;
}

interface Drag {
  column: string;
  over?: string;
  after?: boolean;
}

// DataTable is a results table whose columns can be sorted (click a header),
// resized (drag a header's right edge) and reordered (drag a header).
export function DataTable({ rows, columns, prefs, table, project, linkFor }: Props) {
  // prefs is not reactive; bump re-renders after changes.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [liveWidth, setLiveWidth] = useState<{ column: string; width: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const resizing = useRef(false);

  const layout = prefs.layout(table);
  const cols = orderColumns(columns, layout.order);
  const sort = prefs.sort(project, table);
  const sorted = sortRows(rows, sort && cols.includes(sort.column) ? sort : undefined);
  const widthOf = (c: string) => (liveWidth?.column === c ? liveWidth.width : layout.widths[c]);

  const onHeaderClick = (c: string) => {
    prefs.setSort(project, table, nextSort(sort, c));
    bump();
  };

  const startResize = (e: PointerEvent, c: string) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const cell = handle.parentElement?.querySelector<HTMLElement>(".cell");
    const startX = e.clientX;
    const startW = cell?.offsetWidth ?? layout.widths[c] ?? 100;
    let width = startW;
    resizing.current = true;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      width = clampWidth(startW + ev.clientX - startX);
      setLiveWidth({ column: c, width });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      resizing.current = false;
      prefs.setWidth(table, c, width);
      setLiveWidth(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const dropSide = (e: DragEvent): boolean => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };

  const onDrop = (e: DragEvent, target: string) => {
    e.preventDefault();
    if (drag && drag.column !== target) {
      prefs.setOrder(table, moveColumn(cols, drag.column, target, dropSide(e)));
    }
    setDrag(null);
  };

  const customised = layout.order.length > 0 || Object.keys(layout.widths).length > 0;

  return (
    <>
      {customised && (
        <button type="button" class="link reset-layout" title="Restore default column order and widths"
          onClick={() => { prefs.resetLayout(table); bump(); }}>
          reset columns
        </button>
      )}
      <table class="data">
        <thead>
          <tr>
            {cols.map((c) => {
              const dir = sort?.column === c ? sort.dir : undefined;
              const w = widthOf(c);
              const marker = drag?.over === c && drag.column !== c ? (drag.after ? "drop-after" : "drop-before") : "";
              return (
                <th
                  key={c}
                  class={`${dir ? "sorted" : ""} ${drag?.column === c ? "dragging" : ""} ${marker}`}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                  title="Click to sort · drag to move · drag the right edge to resize"
                  draggable
                  onClick={() => onHeaderClick(c)}
                  onDragStart={(e) => {
                    if (resizing.current) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer?.setData("text/plain", c);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    setDrag({ column: c });
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    const after = dropSide(e);
                    if (drag.over !== c || drag.after !== after) setDrag({ ...drag, over: c, after });
                  }}
                  onDrop={(e) => onDrop(e, c)}
                  onDragEnd={() => setDrag(null)}
                >
                  <div class="cell" style={w ? { width: `${w}px` } : undefined}>
                    {c}
                    <span class="sort-mark">{dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}</span>
                  </div>
                  <span class="resize" onPointerDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const text = String(row[c] ?? "");
                const href = text ? linkFor?.(row, c) : undefined;
                const w = widthOf(c);
                return (
                  <td key={c}>
                    <div class="cell" style={w ? { width: `${w}px` } : undefined} title={w ? text : undefined}>
                      {href
                        ? <a href={href} target="_blank" rel="noopener noreferrer" title="Open in Google Cloud console">{text}</a>
                        : text}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
