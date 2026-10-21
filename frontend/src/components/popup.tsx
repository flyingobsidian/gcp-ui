import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

// usePopup holds the shared state of a box-with-popup picker: whether the
// popup is open, the text typed into the box, and refs for outside-click
// detection and focus. A click outside root closes the popup.
export function usePopup<T extends string>(defaultTab: T, boxRef?: RefObject<HTMLInputElement | null>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<T>(defaultTab);
  const root = useRef<HTMLDivElement>(null);
  const ownBox = useRef<HTMLInputElement>(null);
  const box = boxRef ?? ownBox;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openPopup = () => {
    if (open) return;
    setOpen(true);
    setQuery("");
    setTab(defaultTab);
  };

  // showTab switches tab and keeps typing focus in the box.
  const showTab = (t: T) => {
    setTab(t);
    box.current?.focus();
  };

  // baseKeyDown handles keys common to every picker and reports whether it
  // consumed the event. Tab closes the popup and lets focus move on, so the
  // popup's own controls never sit in the tab order.
  const baseKeyDown = (e: KeyboardEvent): boolean => {
    if (e.key === "Tab") {
      close();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      box.current?.blur();
      return true;
    }
    return false;
  };

  return { open, setOpen, query, setQuery, tab, setTab, root, box, close, openPopup, showTab, baseKeyDown };
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
}

// PopupTabs is the tab bar at the top of a picker popup; children are extra
// controls aligned to the right. None of its buttons take keyboard focus.
export function PopupTabs<T extends string>(props: {
  tabs: TabSpec<T>[]; tab: T; onTab: (t: T) => void; children?: ComponentChildren;
}) {
  return (
    <div class="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} type="button" role="tab" tabIndex={-1} aria-selected={props.tab === t.id}
          class={props.tab === t.id ? "on" : ""} onClick={() => props.onTab(t.id)}>
          {t.label}
        </button>
      ))}
      <span class="tab-actions">{props.children}</span>
    </div>
  );
}
