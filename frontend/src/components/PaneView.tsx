import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText } from "../api.ts";
import { splitArgs } from "../args.ts";
import type { RecentProjects } from "../recentProjects.ts";
import type { ResultCache } from "../resultCache.ts";
import type { ServicePrefs } from "../servicePrefs.ts";
import { buildCommand, catalogueCommand, isValidLocation, serviceById, type Service } from "../services.ts";
import type { HierarchyStore } from "../store.ts";
import type { TablePrefs } from "../tablePrefs.ts";
import { useGcloudRun } from "../useGcloudRun.ts";
import { formatLayout, pane, type Pane } from "../viewState.ts";
import { CommandPane } from "./CommandPane.tsx";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { ServicePicker } from "./ServicePicker.tsx";

export interface Shared {
  store: HierarchyStore;
  prefs: ServicePrefs;
  tablePrefs: TablePrefs;
  results: ResultCache;
  recent: RecentProjects;
  // rememberProject records the last picked project (the default for a new,
  // empty view).
  rememberProject: (id: string) => void;
}

interface Props {
  pane: Pane;
  shared: Shared;
  // onChange reports what the pane now shows; push asks for a new browser
  // history entry (a deliberate pick) rather than replacing the current one.
  onChange: (p: Pane, push: boolean) => void;
  onSplit: (dir: "row" | "col") => void;
  onClose?: () => void;
  // active highlights the pane last interacted with (when there are
  // several); shortcut gives its project picker the "/" key.
  active: boolean;
  shortcut: boolean;
  onActivate: () => void;
}

// commandFor is the list command for a pane's service: its location if
// given, else the location last used for that service.
export function commandFor(p: Pane, prefs: ServicePrefs): string {
  const svc = serviceById(p.service);
  return svc ? buildCommand(svc, p.location || prefs.location(svc.id)).text : "";
}

// PaneView is one pane: project and service pickers, command line, Run,
// split/close buttons and the results table. It starts from pane (project +
// service + location) and reports changes through onChange.
export function PaneView({ pane: initial, shared, onChange, onSplit, onClose, active, shortcut, onActivate }: Props) {
  const { store, prefs, tablePrefs, results, recent } = shared;
  const [project, setProject] = useState(initial.project);
  const [command, setCommand] = useState(() => commandFor(initial, prefs));
  const { state: run, run: runArgs, fail } = useGcloudRun(results);
  const projectBox = useRef<HTMLInputElement>(null);
  const serviceBox = useRef<HTMLInputElement>(null);
  const commandBox = useRef<HTMLInputElement>(null);
  const pushNext = useRef(false);

  const current = useMemo(() => catalogueCommand(command), [command]);
  const shown = pane(
    project,
    current?.service.id ?? "",
    current?.service.locationFlag && isValidLocation(current.location) ? current.location : "",
  );
  const shownKey = formatLayout(shown);

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

  // A new pane (first load, shared URL, or a split) shows its table straight
  // away, from the result cache when fresh.
  useEffect(() => {
    if (project && current?.runnable) execute(command, project, true);
  }, []);

  useEffect(() => {
    onChange(shown, pushNext.current);
    pushNext.current = false;
  }, [shownKey]);

  const focusCommandEnd = () => {
    requestAnimationFrame(() => {
      const el = commandBox.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const selectProject = (id: string) => {
    pushNext.current = true;
    setProject(id);
    recent.add(id);
    shared.rememberProject(id);
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
    <div class={`pane-frame ${active ? "active" : ""}`} onFocusIn={onActivate} onMouseDown={onActivate}>
      <CommandPane
        pickers={<>
          <ProjectPicker store={store} selected={project} onSelect={selectProject} onPicked={afterProjectPicked}
            boxRef={projectBox} recent={recent.ids} shortcut={shortcut} />
          <ServicePicker prefs={prefs} selected={current?.service} onPick={pickService} boxRef={serviceBox} />
        </>}
        command={command}
        onCommand={setCommand}
        onRun={() => execute(command, project, false)}
        run={run}
        commandRef={commandBox}
        tablePrefs={tablePrefs}
        controls={
          <span class="pane-controls">
            <button type="button" tabIndex={-1} title="Split into two columns (copy to the right)" aria-label="Split into columns"
              onClick={() => onSplit("row")}>▥</button>
            <button type="button" tabIndex={-1} title="Split into two rows (copy below)" aria-label="Split into rows"
              onClick={() => onSplit("col")}>▤</button>
            {onClose && (
              <button type="button" tabIndex={-1} title="Close this pane" aria-label="Close pane" onClick={onClose}>✕</button>
            )}
          </span>
        }
      />
    </div>
  );
}
