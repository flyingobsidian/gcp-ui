import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Container, Project } from "../hierarchy.ts";
import { highlight, MAX_RESULTS, searchProjects } from "../search.ts";
import { ORPHANS, type HierarchyStore } from "../store.ts";
import { useStore } from "../useStore.ts";

interface Props {
  store: HierarchyStore;
  selected: string;
  onSelect: (projectId: string) => void;
}

export function ProjectPicker({ store, selected, onSelect }: Props) {
  useStore(store);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const projects = store.allProjects.data ?? [];
  const matches = useMemo(() => searchProjects(projects, query), [projects, query]);
  useEffect(() => setActive(0), [query]);

  // "/" focuses the search box from anywhere outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (p: Project) => {
    onSelect(p.projectId);
    setQuery("");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const m = matches[active];
      if (m) pick(m.project);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  const busy = store.orgs.status === "loading" || store.allProjects.status === "loading" ||
    store.orgs.refreshing || store.allProjects.refreshing;

  return (
    <nav class="picker">
      <div class="picker-bar">
        <input
          ref={input}
          class="search"
          type="search"
          placeholder={`Search ${projects.length || ""} projects  ( / )`}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          spellcheck={false}
          autocomplete="off"
        />
        <button class="icon" title="Reload organizations, folders and projects" onClick={() => store.refresh()} disabled={busy}>
          {busy ? "…" : "⟳"}
        </button>
      </div>
      {query.trim()
        ? <SearchResults store={store} query={query} matches={matches.map((m) => m.project)} active={active} selected={selected} onPick={pick} />
        : <Tree store={store} selected={selected} onSelect={onSelect} />}
    </nav>
  );
}

function SearchResults(props: {
  store: HierarchyStore; query: string; matches: Project[]; active: number; selected: string; onPick: (p: Project) => void;
}) {
  const { store, query, matches, active, selected, onPick } = props;
  if (store.allProjects.status === "loading") return <p class="muted pad">loading projects…</p>;
  if (store.allProjects.status === "error") return <p class="error pad">{store.allProjects.error}</p>;
  if (matches.length === 0) return <p class="muted pad">no matching projects</p>;
  return (
    <ul class="results">
      {matches.map((p, i) => (
        <li
          key={p.key}
          class={`result ${i === active ? "active" : ""} ${p.projectId === selected ? "selected" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onPick(p); }}
        >
          <div class="result-id"><Highlighted text={p.projectId} query={query} /></div>
          {p.displayName !== p.projectId && <div class="result-name"><Highlighted text={p.displayName} query={query} /></div>}
          <div class="result-path">{store.pathOf(p)}</div>
        </li>
      ))}
      {matches.length === MAX_RESULTS && <li class="muted pad">showing first {MAX_RESULTS}; keep typing to narrow</li>}
    </ul>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlight(text, query).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}</>;
}

function Tree({ store, selected, onSelect }: { store: HierarchyStore; selected: string; onSelect: (id: string) => void }) {
  const { orgs } = store;
  if (orgs.status === "loading") return <p class="muted pad">loading organizations…</p>;
  const orphans = store.orphanProjects();
  return (
    <ul class="tree">
      {orgs.status === "error" && <li class="error pad">organizations: {orgs.error}</li>}
      {(orgs.data ?? []).map((o) => (
        <ContainerNode key={o.key} node={o} depth={0} store={store} selected={selected} onSelect={onSelect} />
      ))}
      {orphans.length > 0 && (
        <li>
          <Row depth={0} expanded={store.expanded.has(ORPHANS)} onToggle={() => store.toggle(ORPHANS)} kind="orphans">
            No organization <span class="count">{orphans.length}</span>
          </Row>
          {store.expanded.has(ORPHANS) && (
            <ul>
              {orphans.map((p) => <ProjectNode key={p.key} project={p} depth={1} selected={selected} onSelect={onSelect} />)}
            </ul>
          )}
        </li>
      )}
      {orgs.status === "ok" && (orgs.data ?? []).length === 0 && orphans.length === 0 && store.allProjects.status === "ok" && (
        <li class="muted pad">no organizations or projects visible to this account</li>
      )}
    </ul>
  );
}

function ContainerNode(props: { node: Container; depth: number; store: HierarchyStore; selected: string; onSelect: (id: string) => void }) {
  const { node, depth, store, selected, onSelect } = props;
  const open = store.expanded.has(node.key);
  const kids = store.children.get(node.key);
  return (
    <li>
      <Row depth={depth} expanded={open} onToggle={() => store.toggle(node)} kind={node.kind} title={node.key}>
        {node.displayName}
        {kids?.data && <span class="count">{kids.data.folders.length + kids.data.projects.length}</span>}
        {kids?.refreshing && <span class="muted"> …</span>}
      </Row>
      {open && (
        <ul>
          {(!kids || kids.status === "loading") && <li class="muted" style={indent(depth + 1)}>loading…</li>}
          {kids?.error && <li class="error" style={indent(depth + 1)} title={kids.error}>{kids.error}</li>}
          {kids?.data?.folders.map((f) => (
            <ContainerNode key={f.key} node={f} depth={depth + 1} store={store} selected={selected} onSelect={onSelect} />
          ))}
          {kids?.data?.projects.map((p) => (
            <ProjectNode key={p.key} project={p} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
          {kids?.status === "ok" && kids.data && kids.data.folders.length + kids.data.projects.length === 0 && (
            <li class="muted" style={indent(depth + 1)}>empty</li>
          )}
        </ul>
      )}
    </li>
  );
}

function ProjectNode({ project, depth, selected, onSelect }: { project: Project; depth: number; selected: string; onSelect: (id: string) => void }) {
  return (
    <li>
      <div
        class={`row project ${project.projectId === selected ? "selected" : ""}`}
        style={indent(depth)}
        title={project.displayName !== project.projectId ? `${project.displayName} (${project.projectId})` : project.projectId}
        onClick={() => onSelect(project.projectId)}
      >
        <span class="glyph">•</span>
        {project.projectId}
      </div>
    </li>
  );
}

function Row(props: {
  depth: number; expanded: boolean; onToggle: () => void; kind: string; title?: string; children: ComponentChildren;
}) {
  return (
    <div class={`row ${props.kind}`} style={indent(props.depth)} onClick={props.onToggle} title={props.title}>
      <span class="glyph">{props.expanded ? "▾" : "▸"}</span>
      {props.children}
    </div>
  );
}

const indent = (depth: number) => ({ paddingLeft: `${0.5 + depth * 1.1}em` });
