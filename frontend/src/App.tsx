import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText, getList } from "./api.ts";
import { splitArgs } from "./args.ts";
import { CommandPane } from "./components/CommandPane.tsx";
import { ProjectPicker } from "./components/ProjectPicker.tsx";
import { ServicePicker } from "./components/ServicePicker.tsx";
import { RecentProjects } from "./recentProjects.ts";
import { ResultCache } from "./resultCache.ts";
import { ServicePrefs } from "./servicePrefs.ts";
import { TablePrefs } from "./tablePrefs.ts";
import { buildCommand, catalogueCommand, isValidLocation, serviceById, type Service } from "./services.ts";
import { HierarchyStore } from "./store.ts";
import { useGcloudRun } from "./useGcloudRun.ts";
import {
  emptyPane, firstPanePath, formatLayout, pane, paneAt, readView, withPane, writeView, type Pane, type ViewState,
} from "./viewState.ts";

const SELECTED_KEY = "gcpui:selectedProject";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function App() {
  const store = useMemo(() => {
    const s = new HierarchyStore((path) => getList(path), storage(), errorText);
    s.start();
    return s;
  }, []);
  const prefs = useMemo(() => new ServicePrefs(storage()), []);
  const tablePrefs = useMemo(() => new TablePrefs(storage()), []);

  // The URL holds the view (see viewState.ts). This UI shows one pane: the
  // first pane of the active layout. Other panes in a shared URL are kept
  // as they are.
  const [view, setView] = useState<ViewState>(() => readView(location.search) ?? { layouts: [emptyPane()], active: 0 });
  const focusedPath = firstPanePath(view.layouts[view.active]!);
  const initialPane = useMemo(() => paneAt(view.layouts[view.active]!, focusedPath), []);
  const [project, setProject] = useState(() => initialPane?.project || (storage()?.getItem(SELECTED_KEY) ?? ""));
  const [command, setCommand] = useState(() => (initialPane ? commandFor(initialPane, prefs) : ""));
  // pushNext makes the next URL update a new history entry (Back returns to
  // the previous project/service) instead of replacing the current one.
  const pushNext = useRef(false);
  const results = useMemo(() => new ResultCache(storage()), []);
  const recent = useMemo(() => new RecentProjects(storage()), []);
  const { state: run, run: runArgs, fail } = useGcloudRun(results);
  const projectBox = useRef<HTMLInputElement>(null);
  const serviceBox = useRef<HTMLInputElement>(null);
  const commandBox = useRef<HTMLInputElement>(null);

  const current = useMemo(() => catalogueCommand(command), [command]);
  const shownPane = pane(
    project,
    current?.service.id ?? "",
    current?.service.locationFlag && isValidLocation(current.location) ? current.location : "",
  );
  const shownKey = formatLayout(shownPane);

  // execute runs text for onProject. Switching tables passes useCache, so a
  // recent result is shown instead of re-running gcloud; the Run button does
  // not. Only read-only catalogue list commands are cached.
  const execute = (text: string, onProject: string, useCache: boolean) => {
    let args: string[];
    try {
      args = splitArgs(text);
    } catch (err) {
      fail(errorText(err));
      return;
    }
    if (args[0] === "gcloud") args = args.slice(1);
    if (args.length === 0) return;
    const cat = catalogueCommand(text);
    if (cat?.runnable && cat.location) prefs.setLocation(cat.service.id, cat.location);
    void runArgs(args, onProject, { useCache, cacheable: !!cat?.runnable });
  };

  // focusCommandEnd puts the cursor at the end of the command line, e.g. to
  // type a missing --location value.
  const focusCommandEnd = () => {
    requestAnimationFrame(() => {
      const el = commandBox.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // Keep the URL in step with what is shown.
  useEffect(() => {
    const layout = view.layouts[view.active]!;
    const next: ViewState = { ...view, layouts: view.layouts.map((l, i) => (i === view.active ? withPane(layout, focusedPath, shownPane) : l)) };
    const search = writeView(next, location.search);
    if (search !== location.search) {
      const url = location.pathname + search;
      if (pushNext.current) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
      setView(next);
    }
    pushNext.current = false;
  }, [shownKey]);

  // Back/Forward restore the pane recorded in the URL.
  useEffect(() => {
    const onPop = () => {
      const v = readView(location.search) ?? { layouts: [emptyPane()], active: 0 };
      const p = paneAt(v.layouts[v.active]!, firstPanePath(v.layouts[v.active]!)) ?? emptyPane();
      const cmd = commandFor(p, prefs);
      setView(v);
      setProject(p.project);
      setCommand(cmd);
      if (p.project && catalogueCommand(cmd)?.runnable) execute(cmd, p.project, true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A loaded or shared URL shows its pane straight away (from cache if fresh).
  useEffect(() => {
    if (project && current?.runnable) execute(command, project, true);
  }, []);

  const selectProject = (id: string) => {
    pushNext.current = true;
    setProject(id);
    recent.add(id);
    try {
      if (id) storage()?.setItem(SELECTED_KEY, id);
      else storage()?.removeItem(SELECTED_KEY);
    } catch {
      // Remembering the selection is a convenience only.
    }
    // Switching project re-runs the current command, but only when it is a
    // read-only catalogue list command.
    if (id && current?.runnable) execute(command, id, true);
  };

  const afterProjectPicked = () => {
    if (!current) requestAnimationFrame(() => serviceBox.current?.focus());
  };

  const pickService = (s: Service) => {
    pushNext.current = true;
    prefs.recordUse(s.id);
    const built = buildCommand(s, prefs.location(s.id));
    setCommand(built.text);
    if (!built.runnable) {
      focusCommandEnd();
    } else if (!project) {
      requestAnimationFrame(() => projectBox.current?.focus());
    } else {
      execute(built.text, project, true);
    }
  };

  return (
    <div class="layout">
      <CommandPane
        pickers={<>
          <ProjectPicker store={store} selected={project} onSelect={selectProject} onPicked={afterProjectPicked} boxRef={projectBox}
            recent={recent.ids} />
          <ServicePicker prefs={prefs} selected={current?.service} onPick={pickService} boxRef={serviceBox} />
        </>}
        command={command}
        onCommand={setCommand}
        onRun={() => execute(command, project, false)}
        run={run}
        commandRef={commandBox}
        tablePrefs={tablePrefs}
      />
    </div>
  );
}

// commandFor is the list command for a pane's service: its location if the
// URL gave one, else the location last used for that service.
function commandFor(p: Pane, prefs: ServicePrefs): string {
  const svc = serviceById(p.service);
  return svc ? buildCommand(svc, p.location || prefs.location(svc.id)).text : "";
}
