import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { errorText, runGcloud, type RunResponse } from "../api.ts";
import { splitArgs } from "../args.ts";
import { JsonView } from "./JsonView.tsx";

interface Result {
  response: RunResponse;
  roundTripMs: number;
}

// CommandPane runs an arbitrary gcloud command against the selected project.
// picker is rendered at the start of the command line.
export function CommandPane({ project, picker }: { project: string; picker: ComponentChildren }) {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    let args: string[];
    try {
      args = splitArgs(command);
    } catch (err) {
      setError(errorText(err));
      return;
    }
    if (args[0] === "gcloud") args = args.slice(1);
    if (args.length === 0) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    setError("");
    const started = performance.now();
    try {
      const response = await runGcloud(args, project, ctl.signal);
      setResult({ response, roundTripMs: Math.round(performance.now() - started) });
    } catch (err) {
      if (!ctl.signal.aborted) setError(errorText(err));
    } finally {
      if (abort.current === ctl) setRunning(false);
    }
  };

  const out = result?.response;
  return (
    <section class="pane">
      <form class="command" onSubmit={submit}>
        {picker}
        <span class="muted">gcloud</span>
        <input
          value={command}
          onInput={(e) => setCommand(e.currentTarget.value)}
          placeholder="compute instances list"
          spellcheck={false}
          autocomplete="off"
        />
        <button type="submit" disabled={running}>{running ? "…" : "Run"}</button>
      </form>
      <div class={`status ${error ? "error" : ""}`}>
        {error || (running ? "running…" : out && [
          Array.isArray(out.output) ? `${out.output.length} items · ` : "",
          `gcloud ${out.durationMs} ms · round trip ${result.roundTripMs} ms`,
        ].join(""))}
      </div>
      <div class="output">
        {out && <JsonView value={out.output !== undefined ? out.output : out.outputText ?? ""} />}
      </div>
    </section>
  );
}
