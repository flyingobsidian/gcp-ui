import { useRef, useState } from "preact/hooks";
import { errorText, runGcloud, type RunResponse } from "./api.ts";
import type { ResultCache } from "./resultCache.ts";

export interface RunState {
  running: boolean;
  response?: RunResponse;
  roundTripMs?: number;
  // project and args are those of the run that produced response.
  project?: string;
  args?: string[];
  // cachedAt is set when response came from the result cache.
  cachedAt?: number;
  error: string;
}

export interface RunOptions {
  // useCache shows a fresh cached result instead of running gcloud.
  useCache: boolean;
  // cacheable stores a successful result (only read-only list commands).
  cacheable: boolean;
}

// useGcloudRun runs gcloud commands through the API, cancelling any run still
// in flight when a new one starts.
export function useGcloudRun(cache: ResultCache) {
  const [state, setState] = useState<RunState>({ running: false, error: "" });
  const abort = useRef<AbortController | null>(null);

  const run = async (args: string[], project: string, opts: RunOptions) => {
    abort.current?.abort();
    abort.current = null;
    if (opts.useCache && opts.cacheable) {
      const hit = cache.fresh(project, args);
      if (hit) {
        setState({ running: false, error: "", response: hit.response, project, args, cachedAt: hit.fetchedAt });
        return;
      }
    }
    const ctl = new AbortController();
    abort.current = ctl;
    setState((s) => ({ ...s, running: true, error: "" }));
    const started = performance.now();
    try {
      const response = await runGcloud(args, project, ctl.signal);
      if (abort.current === ctl) {
        if (opts.cacheable) cache.put(project, args, response);
        setState({ running: false, error: "", response, project, args, roundTripMs: Math.round(performance.now() - started) });
      }
    } catch (err) {
      if (!ctl.signal.aborted) setState((s) => ({ ...s, running: false, error: errorText(err) }));
    }
  };

  const fail = (error: string) => setState((s) => ({ ...s, running: false, error }));

  return { state, run, fail };
}
