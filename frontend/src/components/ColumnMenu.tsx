import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  columns: string[];
  visible: string[];
  hasDefaults: boolean;
  onToggle: (column: string) => void;
  onShowAll: () => void;
  onDefaults: () => void;
}

// ColumnMenu is the ☰ dropdown in a table's header row for showing and
// hiding columns. At least one column always stays visible.
export function ColumnMenu({ columns, visible, hasDefaults, onToggle, onShowAll, onDefaults }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div class="column-menu" ref={root}>
      <button type="button" class="column-menu-button" title="Show or hide columns" aria-expanded={open}
        aria-label="Show or hide columns" onClick={() => setOpen((o) => !o)}>
        ☰
      </button>
      {open && (
        <div class="column-menu-popup" role="menu">
          <div class="column-menu-actions">
            <button type="button" class="link" onClick={onShowAll}>show all</button>
            {hasDefaults && <button type="button" class="link" onClick={onDefaults}>defaults</button>}
          </div>
          <ul>
            {columns.map((c) => {
              const on = visible.includes(c);
              return (
                <li key={c}>
                  <label title={on && visible.length === 1 ? "At least one column must stay visible" : undefined}>
                    <input type="checkbox" checked={on} disabled={on && visible.length === 1} onChange={() => onToggle(c)} />
                    {c}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
