import type { RefObject } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { highlight } from "../search.ts";
import type { ServicePrefs } from "../servicePrefs.ts";
import { buildCommand, filterServices, SERVICES, type Service } from "../services.ts";
import { PopupTabs, usePopup } from "./popup.tsx";

type Tab = "frequent" | "all";

interface Props {
  prefs: ServicePrefs;
  selected?: Service;
  onPick: (s: Service) => void;
  boxRef: RefObject<HTMLInputElement | null>;
}

// ServicePicker chooses which resource type to list. Its popup has a Frequent
// tab (starred and most-used services, most used first) and an All tab (the
// whole catalogue by category). Typing filters the current tab.
export function ServicePicker({ prefs, selected, onPick, boxRef }: Props) {
  const p = usePopup<Tab>("frequent", boxRef);
  const [active, setActive] = useState(0);
  // prefs is not reactive; bump re-renders after starring.
  const [version, setVersion] = useState(0);

  const frequent = useMemo(() => filterServices(prefs.frequent(), p.query), [prefs, p.query, version, p.open]);
  const all = useMemo(() => filterServices(SERVICES, p.query), [p.query]);
  const items = p.tab === "frequent" ? frequent : all;
  useEffect(() => setActive(0), [p.query, p.tab]);

  const choose = (s: Service) => {
    p.close();
    p.box.current?.blur();
    onPick(s);
  };

  const toggleStar = (s: Service) => {
    prefs.toggleStar(s.id);
    setVersion((v) => v + 1);
    p.box.current?.focus();
  };

  const onInput = (value: string) => {
    p.setOpen(true);
    p.setQuery(value);
    if (p.tab === "frequent" && filterServices(prefs.frequent(), value).length === 0) p.setTab("all");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (p.baseKeyDown(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const s = items[active];
      if (s) choose(s);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
  };

  const grouped = p.tab === "all" && !p.query.trim();

  return (
    <div class="picker" ref={p.root}>
      <input
        ref={p.box}
        class={`picker-box service-box ${selected ? "" : "none"}`}
        value={p.open ? p.query : selected?.name ?? ""}
        placeholder={p.open ? (selected?.name ?? "search services") : "choose service"}
        title={selected ? `Service: ${selected.name}` : "No service selected"}
        aria-label="Service"
        onFocus={p.openPopup}
        onClick={p.openPopup}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        spellcheck={false}
        autocomplete="off"
      />
      {p.open && (
        <div class="popup">
          <PopupTabs<Tab>
            tabs={[
              { id: "frequent", label: `Frequent${p.query.trim() ? ` (${frequent.length})` : ""}` },
              { id: "all", label: `All${p.query.trim() ? ` (${all.length})` : ""}` },
            ]}
            tab={p.tab}
            onTab={p.showTab}
          />
          <div class="popup-body">
            {items.length === 0
              ? <p class="muted pad">{p.tab === "frequent" && !p.query.trim() ? "star services in the All tab to keep them here" : "no matching services"}</p>
              : (
                <ul class="results services">
                  {items.map((s, i) => (
                    <>
                      {grouped && (i === 0 || items[i - 1]!.category !== s.category) && (
                        <li key={`h-${s.category}`} class="category">{s.category}</li>
                      )}
                      <li
                        key={s.id}
                        class={`service ${i === active ? "active" : ""} ${s.id === selected?.id ? "selected" : ""}`}
                        ref={i === active ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                        onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                      >
                        <span class="service-name"><Highlighted text={s.name} query={p.query} /></span>
                        <span class="service-cmd">{buildCommand(s, prefs.location(s.id) || "…").text}</span>
                        <button
                          type="button"
                          tabIndex={-1}
                          class={`star ${prefs.isStarred(s.id) ? "on" : ""}`}
                          title={prefs.isStarred(s.id) ? "Unstar" : "Star (always show in Frequent)"}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleStar(s); }}
                        >
                          {prefs.isStarred(s.id) ? "★" : "☆"}
                        </button>
                      </li>
                    </>
                  ))}
                </ul>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlight(text, query).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}</>;
}
