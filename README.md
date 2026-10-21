# gcp-ui

This repo contains a fast, localhost-only web UI for Google Cloud. A Go backend
runs `gcloud … --format=json` and the browser renders the JSON. See
[PLAN.md](PLAN.md) for the design and roadmap.

## Run

Build the binary (`bin/gcp-ui`), then serve:
- web UI: http://127.0.0.1:8080/
- API: http://127.0.0.1:32000/

```sh
make run
```

| Flag         | Env              | Default |
|--------------|------------------|---------|
| `--web-port` | `GCPUI_WEB_PORT` | `8080` |
| `--api-port` | `GCPUI_API_PORT` | `32000` |
| `--bind`     | `GCPUI_BIND`     | `127.0.0.1` (loopback only; anything else is refused) |
| `--gcloud`   | `GCPUI_GCLOUD`   | `gcloud` on `$PATH` |
| `--timeout`  | `GCPUI_TIMEOUT`  | `2m` per command |
| `--max-concurrent` | `GCPUI_MAX_CONCURRENT` | `8` gcloud processes |

Flags override environment variables.

## API

```
POST /v1/run   (token: UI cookie, or Authorization: Bearer <token>)
{"args": ["compute", "instances", "list"], "project": "my-project"}

200 {"output": [...], "stderr": "", "exitCode": 0, "durationMs": 812}
4xx/5xx {"error": {"cause": "exit_status", "message": "...", "stderr": "...", "exitCode": 1}}

GET /v1/projects                         gcloud projects list   (every visible project)
GET /v1/organizations                    gcloud organizations list
GET /v1/organizations/{orgID}/folders    gcloud resource-manager folders list --organization=ORG_ID
GET /v1/organizations/{orgID}/projects   gcloud projects list --organization=ORG_ID   (direct children only)
GET /v1/folders/{folderID}/folders       gcloud resource-manager folders list --folder=FOLDER_ID
GET /v1/folders/{folderID}/projects      gcloud projects list --folder=FOLDER_ID

GET /v1/healthz   (no token)
```

- The hierarchy endpoints take bare numeric IDs: a positive integer, at most
  19 digits, no leading zero.
- IDs are validated before gcloud runs. Anything else returns
  `400 invalid_request`.
- These endpoints use the same response shape as `/v1/run`, and an empty list
  is always returned as `[]`.

- `args` is passed to gcloud as an argv list, never through a shell.
- gcp-ui adds `--format=json` and `--project=…` itself, so `args` must not set
  either.
- If stdout is not JSON, it is returned as text in `outputText`.
- Error causes: `invalid_request`, `exit_status`, `timeout`, `cancelled`,
  `output_too_large`, `start_failed`.

## Security model

The API runs gcloud with your credentials, so it only answers the local UI:

- Both servers listen on loopback only.
- Loopback is reachable by every user on the machine, so the access token
  below is the only gate. Anyone who has the token, whichever OS user they
  are, can use gcp-ui.
- Each run generates a random UUID4 access token and prints
  `open http://localhost:8080/#<token>`.
  - The token is in the URL fragment, which browsers never send to the server.
    The page itself contains no token.
  - The UI copies the token into a `SameSite=Strict` session cookie,
    `gcpui_token_<api-port>`, then removes it from the address bar.
  - The browser sends the cookie with every API request. Every endpoint except
    `/v1/healthz` checks it in constant time.
  - Without a valid token, the UI shows "Access token required" and loads
    nothing, not even cached data.
  - Restarting gcp-ui issues a new token, so open the newly printed URL.
  - A cookie-authenticated request must also carry the UI's `Origin`. Scripts
    can send `Authorization: Bearer <token>` instead.
- `Host` headers must be loopback names. This blocks DNS rebinding.
- Browser requests must carry the web UI's `Origin`.
- The page sends a strict Content-Security-Policy and cannot be framed.

## Develop

The frontend is Preact + TypeScript in `frontend/`, built by Vite into
`internal/web/dist/`, which is embedded in the Go binary. You need Node.js;
dependencies are pinned and installed with `npm ci --ignore-scripts`.

```sh
make build   # npm ci (if needed) + vite build + go build
make test    # frontend unit tests (node --test) + go test
make lint    # go vet + tsc --noEmit + gofmt check
```

While working on the UI, run `cd frontend && npm run watch` alongside the
server. Restart `bin/gcp-ui` after `go build`, because assets are embedded at
build time.

## Project picker

- The command bar starts with one box showing the chosen project.
- Clicking the box, or pressing `/`, opens a popup below it with two tabs:
  - **Search**: filters all projects by ID or display name. Space-separated
    words must all match. Typing in the box switches to this tab. ↑/↓ moves
    the selection and Enter picks.
  - **Tree**: lists every visible organization, each starting expanded, with
    its folders and projects. Folders load lazily when expanded. Projects with
    no visible organization appear under **No organization**.
- Picking a project closes the popup. So do Esc and clicking outside, which
  keep the current project. **clear** unsets the project.
- Every response is cached in memory and in `localStorage`. A reload paints
  from cache with no API calls.
- Cached entries older than 10 minutes are shown immediately and refreshed in
  the background.
- **⟳** clears the cache and reloads everything.
