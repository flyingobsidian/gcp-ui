import { useEffect, useState } from "preact/hooks";
import type { HierarchyStore } from "./store.ts";

// useStore re-renders the calling component whenever the store changes.
export function useStore(store: HierarchyStore): void {
  const [, setVersion] = useState(store.snapshot);
  useEffect(() => store.subscribe(() => setVersion(store.snapshot)), [store]);
}
