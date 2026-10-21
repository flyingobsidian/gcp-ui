import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { checkSession, errorText, UNAUTHORIZED } from "../api.ts";

type State = { kind: "checking" } | { kind: "ok" } | { kind: "denied" } | { kind: "error"; message: string };

// AuthGate renders its children only once the API accepts the token cookie.
// Nothing, including cached data, is shown before that.
export function AuthGate({ children }: { children: ComponentChildren }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let live = true;
    checkSession().then(
      (ok) => live && setState(ok ? { kind: "ok" } : { kind: "denied" }),
      (err) => live && setState({ kind: "error", message: errorText(err) }),
    );
    const onDenied = () => setState({ kind: "denied" });
    window.addEventListener(UNAUTHORIZED, onDenied);
    return () => {
      live = false;
      window.removeEventListener(UNAUTHORIZED, onDenied);
    };
  }, []);

  switch (state.kind) {
    case "checking":
      return null;
    case "ok":
      return <>{children}</>;
    case "denied":
      return (
        <div class="gate">
          <h1>Access token required</h1>
          <p>Open the URL that gcp-ui printed when it started:</p>
          <pre>open http://{location.host}/#&lt;token&gt;</pre>
          <p class="muted">Each gcp-ui start issues a new token, so links from a previous run stop working.</p>
        </div>
      );
    case "error":
      return (
        <div class="gate">
          <h1>Cannot reach gcp-ui</h1>
          <p class="error">{state.message}</p>
          <p class="muted">Is gcp-ui still running?</p>
        </div>
      );
  }
}
