import { useRef, useState } from "preact/hooks";
import { errorText, runGcloud, type RunResponse } from "./api.ts";

export interface RunState {
  running: boolean;
  response?: RunResponse;
  roundTripMs?: number;
  // project and args are those of the run that produced response.
  project?: string;
  args?: string[];
  error: string;
}

// useGcloudRun runs gcloud commands through the API, cancelling any run still
// in flight when a new one starts.
export function useGcloudRun() {
  const [state, setState] = useState<RunState>({ running: false, error: "" });
  const abort = useRef<AbortController | null>(null);

  const run = async (args: string[], project: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setState((s) => ({ ...s, running: true, error: "" }));
    const started = performance.now();
    try {
      const response = await runGcloud(args, project, ctl.signal);
      if (abort.current === ctl) {
        setState({ running: false, error: "", response, project, args, roundTripMs: Math.round(performance.now() - started) });
      }
    } catch (err) {
      if (!ctl.signal.aborted) setState((s) => ({ ...s, running: false, error: errorText(err) }));
    }
  };

  const fail = (error: string) => setState((s) => ({ ...s, running: false, error }));

  return { state, run, fail };
}
