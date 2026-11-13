import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { copyToClipboard } from "../clipboard.ts";
import type { CellLinker } from "../consoleLinks.ts";
import { highlight } from "../search.ts";
import { displayColumns, displayRow, type RowAction, type TableDefaults } from "../tableDefaults.ts";
import { cellText, filterRows } from "../tableFilter.ts";
import {
  clampWidth, moveColumn, nextSort, orderColumns, sortRows, toggleColumn, visibleColumns, type TablePrefs,
} from "../tablePrefs.ts";
import { ColumnMenu } from "./ColumnMenu.tsx";

type Row = Record<string, unknown>;

interface Props {
  rows: Row[];
  columns: string[];
  prefs: TablePrefs;
  // table identifies the kind of table (e.g. the catalogue service) for
  // remembered layout; project scopes the remembered sort.
  table: string;
  project: string;
  defaults?: TableDefaults;
  linkFor?: CellLinker;
}

interface Drag {
  column: string;
  over?: string;
  after?: boolean;
}

// DataTable is a results table whose columns can be sorted (click a header),
// resized (drag a header's right edge), reordered (drag a header) and shown
// or hidden (the ☰ menu). The filter box above it hides rows not matching the
// typed text, which is highlighted in the rows that remain.
//
// Cells show display values (see tableDefaults), which are also what sorting
// and filtering use; console links and row actions get the raw gcloud row.
export function DataTable({ rows, columns, prefs, table, project, defaults, linkFor }: Props) {
  // prefs is not reactive; bump re-renders after changes.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [liveWidth, setLiveWidth] = useState<{ column: string; width: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const resizing = useRef(false);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);

  // Display rows, plus a map back to the raw row each came from.
  const [view, rawOf] = useMemo(() => {
    const raw = new WeakMap<Row, Row>();
    const shown = rows.map((r) => {
      const d = displayRow(r, defaults);
      raw.set(d, r);
      return d;
    });
    return [shown, raw] as const;
  }, [rows, defaults]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const layout = prefs.layout(table);
  const allCols = orderColumns(displayColumns(columns, defaults), layout.order.length ? layout.order : defaults?.columns ?? []);
  const cols = visibleColumns(allCols, layout.visible, defaults?.columns);
  const sort = prefs.sort(project, table);
  const shown = filterRows(view, cols, filter);
  const sorted = sortRows(shown, sort && cols.includes(sort.column) ? sort : undefined);
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
      prefs.setOrder(table, moveColumn(allCols, drag.column, target, dropSide(e)));
    }
    setDrag(null);
  };

  const runAction = async (action: RowAction, raw: Row, key: string) => {
    const text = action.copyText(raw, project);
    if (!text) return;
    setCopied({ key, ok: await copyToClipboard(text) });
  };

  const customised = layout.order.length > 0 || Object.keys(layout.widths).length > 0 || layout.visible !== undefined;

  return (
    <>
      <div class="table-tools">
        <input
          type="search"
          class="table-filter"
          placeholder="filter rows"
          aria-label="Filter rows"
          value={filter}
          onInput={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
          spellcheck={false}
          autocomplete="off"
        />
        <span class="muted filter-count">
          {filter.trim() ? `${shown.length} of ${rows.length} rows` : `${rows.length} rows`}
          {cols.length < allCols.length ? ` · ${cols.length} of ${allCols.length} columns` : ""}
        </span>
        {customised && (
          <button type="button" class="link reset-layout" title="Restore default columns, order and widths"
            onClick={() => { prefs.resetLayout(table); bump(); }}>
            reset columns
          </button>
        )}
      </div>
      <table class="data">
        <thead>
          <tr>
            <th class="menu-cell">
              <ColumnMenu
                columns={allCols}
                visible={cols}
                hasDefaults={!!defaults}
                onToggle={(c) => { prefs.setVisible(table, toggleColumn(cols, c)); bump(); }}
                onShowAll={() => { prefs.setVisible(table, [...allCols]); bump(); }}
                onDefaults={() => { prefs.setVisible(table, undefined); bump(); }}
              />
            </th>
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
          {sorted.map((row, i) => {
            const raw = rawOf.get(row) ?? row;
            return (
              <tr key={i}>
                <td class="menu-cell" />
                {cols.map((c) => {
                  const text = cellText(row[c]);
                  const content = filter.trim() ? <Highlighted text={text} query={filter} /> : text;
                  const href = text ? linkFor?.(raw, c) : undefined;
                  const w = widthOf(c);
                  const actions = (defaults?.actions?.[c] ?? []).filter((a) => a.copyText(raw, project) !== undefined);
                  return (
                    <td key={c}>
                      <div class="cell" style={w ? { width: `${w}px` } : undefined} title={w ? text : undefined}>
                        {href
                          ? <a href={href} target="_blank" rel="noopener noreferrer" title="Open in Google Cloud console">{content}</a>
                          : content}
                        {actions.map((a, j) => {
                          const key = `${i}:${c}:${j}`;
                          const done = copied?.key === key ? copied : undefined;
                          return (
                            <button
                              key={j}
                              type="button"
                              class={`row-action ${done ? (done.ok ? "copied" : "failed") : ""}`}
                              title={done ? (done.ok ? "Copied" : "Could not copy to the clipboard") : a.title}
                              onClick={() => runAction(a, raw, key)}
                            >
                              {done ? (done.ok ? "✓" : "✗") : a.icon}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr><td class="muted no-match" colSpan={cols.length + 1}>no rows match “{filter.trim()}”</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlight(text, query).map((seg, i) => (seg.hit ? <mark key={i}>{seg.text}</mark> : seg.text))}</>;
}
