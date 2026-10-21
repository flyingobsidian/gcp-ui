import type { ComponentChildren, RefObject } from "preact";
import type { RunState } from "../useGcloudRun.ts";
import { JsonView } from "./JsonView.tsx";

interface Props {
  // pickers are rendered at the start of the command line.
  pickers: ComponentChildren;
  command: string;
  onCommand: (command: string) => void;
  onRun: () => void;
  run: RunState;
  commandRef: RefObject<HTMLInputElement | null>;
}

// CommandPane is the command line (pickers, gcloud command, Run) and the
// output of the last run.
export function CommandPane({ pickers, command, onCommand, onRun, run, commandRef }: Props) {
  const submit = (e: Event) => {
    e.preventDefault();
    onRun();
  };

  const out = run.response;
  return (
    <section class="pane">
      <form class="command" onSubmit={submit}>
        {pickers}
        <span class="muted">gcloud</span>
        <input
          ref={commandRef}
          value={command}
          onInput={(e) => onCommand(e.currentTarget.value)}
          placeholder="compute instances list"
          aria-label="gcloud command"
          spellcheck={false}
          autocomplete="off"
        />
        <button type="submit" disabled={run.running}>{run.running ? "…" : "Run"}</button>
      </form>
      <div class={`status ${run.error ? "error" : ""}`}>
        {run.error || (run.running ? "running…" : out && [
          Array.isArray(out.output) ? `${out.output.length} items · ` : "",
          run.project ? `${run.project} · ` : "",
          `gcloud ${out.durationMs} ms · round trip ${run.roundTripMs} ms`,
        ].join(""))}
      </div>
      <div class="output">
        {out && <JsonView value={out.output !== undefined ? out.output : out.outputText ?? ""} />}
      </div>
    </section>
  );
}
