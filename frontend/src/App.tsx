import { useMemo, useState } from "preact/hooks";
import { errorText, getList } from "./api.ts";
import { CommandPane } from "./components/CommandPane.tsx";
import { ProjectPicker } from "./components/ProjectPicker.tsx";
import { HierarchyStore } from "./store.ts";

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
  const [project, setProject] = useState(() => storage()?.getItem(SELECTED_KEY) ?? "");

  const select = (id: string) => {
    setProject(id);
    try {
      if (id) storage()?.setItem(SELECTED_KEY, id);
      else storage()?.removeItem(SELECTED_KEY);
    } catch {
      // Remembering the selection is a convenience only.
    }
  };

  return (
    <div class="layout">
      <ProjectPicker store={store} selected={project} onSelect={select} />
      <CommandPane project={project} onClearProject={() => select("")} />
    </div>
  );
}
