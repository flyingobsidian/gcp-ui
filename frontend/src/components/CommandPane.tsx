import type { ComponentChildren, RefObject } from "preact";
import { useMemo } from "preact/hooks";
import { linkerFor } from "../consoleLinks.ts";
import { matchCommand } from "../services.ts";
import type { TablePrefs } from "../tablePrefs.ts";
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
  tablePrefs: TablePrefs;
}

// tableIdFor names the table produced by a non-catalogue command by its
// command words, ignoring flags, so "compute instances list --filter=x" shares
// its layout with "compute instances list".
function tableIdFor(args: readonly string[]): string {
  return "cmd:" + args.filter((a) => !a.startsWith("-")).join(" ");
}

// CommandPane is the command line (pickers, gcloud command, Run) and the
// output of the last run.
export function CommandPane({ pickers, command, onCommand, onRun, run, commandRef, tablePrefs }: Props) {
  const submit = (e: Event) => {
    e.preventDefault();
    onRun();
  };

  const out = run.response;
  // Links are derived from the command that produced the output, not from
  // whatever is currently typed in the command line.
  const serviceId = useMemo(() => (run.args ? matchCommand(run.args)?.service.id : undefined), [run.args]);
  const linkFor = useMemo(() => linkerFor(serviceId, run.project ?? ""), [serviceId, run.project]);
  const table = serviceId ?? tableIdFor(run.args ?? []);
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
        {out && (
          <JsonView value={out.output !== undefined ? out.output : out.outputText ?? ""}
            prefs={tablePrefs} table={table} project={run.project ?? ""} linkFor={linkFor} />
        )}
      </div>
    </section>
  );
}
