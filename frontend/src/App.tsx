import { useMemo, useRef, useState } from "preact/hooks";
import { errorText, getList } from "./api.ts";
import { splitArgs } from "./args.ts";
import { CommandPane } from "./components/CommandPane.tsx";
import { ProjectPicker } from "./components/ProjectPicker.tsx";
import { ServicePicker } from "./components/ServicePicker.tsx";
import { ServicePrefs } from "./servicePrefs.ts";
import { TablePrefs } from "./tablePrefs.ts";
import { buildCommand, catalogueCommand, type Service } from "./services.ts";
import { HierarchyStore } from "./store.ts";
import { useGcloudRun } from "./useGcloudRun.ts";

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
  const [project, setProject] = useState(() => storage()?.getItem(SELECTED_KEY) ?? "");
  const [command, setCommand] = useState("");
  const { state: run, run: runArgs, fail } = useGcloudRun();
  const projectBox = useRef<HTMLInputElement>(null);
  const serviceBox = useRef<HTMLInputElement>(null);
  const commandBox = useRef<HTMLInputElement>(null);

  const current = useMemo(() => catalogueCommand(command), [command]);

  const execute = (text: string, onProject: string) => {
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
    void runArgs(args, onProject);
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

  const selectProject = (id: string) => {
    setProject(id);
    try {
      if (id) storage()?.setItem(SELECTED_KEY, id);
      else storage()?.removeItem(SELECTED_KEY);
    } catch {
      // Remembering the selection is a convenience only.
    }
    // Switching project re-runs the current command, but only when it is a
    // read-only catalogue list command.
    if (id && current?.runnable) execute(command, id);
  };

  const afterProjectPicked = () => {
    if (!current) requestAnimationFrame(() => serviceBox.current?.focus());
  };

  const pickService = (s: Service) => {
    prefs.recordUse(s.id);
    const built = buildCommand(s, prefs.location(s.id));
    setCommand(built.text);
    if (!built.runnable) {
      focusCommandEnd();
    } else if (!project) {
      requestAnimationFrame(() => projectBox.current?.focus());
    } else {
      execute(built.text, project);
    }
  };

  return (
    <div class="layout">
      <CommandPane
        pickers={<>
          <ProjectPicker store={store} selected={project} onSelect={selectProject} onPicked={afterProjectPicked} boxRef={projectBox} />
          <ServicePicker prefs={prefs} selected={current?.service} onPick={pickService} boxRef={serviceBox} />
        </>}
        command={command}
        onCommand={setCommand}
        onRun={() => execute(command, project)}
        run={run}
        commandRef={commandBox}
        tablePrefs={tablePrefs}
      />
    </div>
  );
}
