import { render } from "preact";
import { meta } from "./api.ts";
import { App } from "./App.tsx";
import { adoptFragmentToken } from "./auth.ts";
import { AuthGate } from "./components/AuthGate.tsx";
import "./styles.css";

const cookieName = meta("gcpui-cookie");
adoptFragmentToken(cookieName);

// Opening the printed URL in a tab that already shows gcp-ui only changes the
// fragment, which does not reload the page: adopt the token and start over.
window.addEventListener("hashchange", () => {
  if (!location.hash) return;
  adoptFragmentToken(cookieName);
  location.reload();
});

render(<AuthGate><App /></AuthGate>, document.getElementById("app")!);
