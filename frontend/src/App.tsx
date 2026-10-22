import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText, getList } from "./api.ts";
import { PaneView, type Shared } from "./components/PaneView.tsx";
import { RecentProjects } from "./recentProjects.ts";
import { ResultCache } from "./resultCache.ts";
import { ServicePrefs } from "./servicePrefs.ts";
import { HierarchyStore } from "./store.ts";
import { TablePrefs } from "./tablePrefs.ts";
import {
  closePane, formatLayout, layoutRects, newPaneId, pane, panesOf, readView, splitPane, updatePane, withIds, writeView,
  type Layout, type Pane, type ViewState,
} from "./viewState.ts";

const SELECTED_KEY = "gcpui:selectedProject";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// initialView reads the view from the URL, or starts with one pane on the
// last picked project.
function initialView(): ViewState {
  const v = readView(location.search) ?? { layouts: [pane(storage()?.getItem(SELECTED_KEY) ?? "")], active: 0 };
  return { ...v, layouts: v.layouts.map(withIds) };
}

const pct = (f: number) => `${(f * 100).toFixed(4)}%`;

// App holds the view: layouts (one shown at a time) whose panes are drawn
// flat, each positioned from the split tree, so splitting or closing a pane
// never remounts the others. The view is kept in the URL (see viewState.ts).
export function App() {
  const store = useMemo(() => {
    const s = new HierarchyStore((path) => getList(path), storage(), errorText);
    s.start();
    return s;
  }, []);
  const shared = useMemo<Shared>(() => ({
    store,
    prefs: new ServicePrefs(storage()),
    tablePrefs: new TablePrefs(storage()),
    results: new ResultCache(storage()),
    recent: new RecentProjects(storage()),
    rememberProject: (id: string) => {
      try {
        if (id) storage()?.setItem(SELECTED_KEY, id);
      } catch {
        // Remembering the selection is a convenience only.
      }
    },
  }), [store]);

  const [view, setView] = useState<ViewState>(initialView);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  // pushNext makes the next URL update a new history entry (Back returns to
  // the previous view) instead of replacing the current one.
  const pushNext = useRef(false);

  const layout = view.layouts[view.active]!;
  const setLayout = (f: (l: Layout) => Layout, push: boolean) => {
    if (push) pushNext.current = true;
    setView((v) => ({ ...v, layouts: v.layouts.map((l, i) => (i === v.active ? f(l) : l)) }));
  };

  // Keep the URL in step with the view.
  const encoded = writeView(view);
  useEffect(() => {
    const search = writeView(view, location.search);
    if (search !== location.search) {
      const url = location.pathname + search;
      if (pushNext.current) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    }
    pushNext.current = false;
  }, [encoded]);

  // Back/Forward restore the view recorded in the URL. Panes get new ids,
  // so they start afresh from the URL (tables come from the result cache).
  useEffect(() => {
    const onPop = () => setView(initialView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const panes = panesOf(layout);
  const active = panes.find((p) => p.id === activeId) ?? panes[0];

  const onChange = (id: string, p: Pane, push: boolean) =>
    setLayout((l) => updatePane(l, id, (old) => (formatLayout(old) === formatLayout(p) ? old : { ...p, id: old.id })), push);

  const onSplit = (id: string, dir: "row" | "col") => {
    const newId = newPaneId();
    setLayout((l) => splitPane(l, id, dir, newId), true);
    setActiveId(newId);
  };

  const onClose = (id: string) => setLayout((l) => closePane(l, id), true);

  return (
    <div class="layout panes">
      {layoutRects(layout).map(({ pane: p, x, y, w, h }) => (
        <div
          key={p.id}
          class={`pane-slot ${x > 0 ? "left-edge" : ""} ${y > 0 ? "top-edge" : ""}`}
          style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }}
        >
          <PaneView
            pane={p}
            shared={shared}
            onChange={(next, push) => onChange(p.id!, next, push)}
            onSplit={(dir) => onSplit(p.id!, dir)}
            onClose={panes.length > 1 ? () => onClose(p.id!) : undefined}
            active={panes.length > 1 && p.id === active?.id}
            shortcut={p.id === active?.id}
            onActivate={() => { if (p.id !== activeId) setActiveId(p.id); }}
          />
        </div>
      ))}
    </div>
  );
}
