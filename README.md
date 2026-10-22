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
| `--timeout`  | `GCPUI_TIMEOUT`  | `2m` per command |
| `--max-concurrent` | `GCPUI_MAX_CONCURRENT` | `8` gcloud processes |

Flags override environment variables.

## gcloud

gcp-ui does not use a `gcloud` from `$PATH`. It links
[gcloud-go](https://github.com/flyingobsidian/gcloud-go) in as a Go module.
Each command runs in a re-executed copy of the gcp-ui binary, in "gcloud-go
mode", so commands still run as separate processes with their own timeout. That
copy is `/proc/self/exe`, so it is always the same build as the running server.
gcp-ui never accepts gcloud-go's offer to enable a disabled API.

| Command | Effect |
|---|---|
| `make gcloud-go-which` | Show which gcloud-go the build uses |
| `make gcloud-go-update REF=main` | Pin another commit, branch or tag in `go.mod` |
| `make gcloud-go-local` | Build against the checkout in `../gcloud-go` (or `GCLOUD_GO_DIR=…`) using a gitignored `go.work` |
| `make gcloud-go-versioned` | Remove `go.work` and go back to the version pinned in `go.mod` |

The gcloud-go version is printed at startup, and is also what
`GCPUI_RUN_GCLOUD_GO=1 bin/gcp-ui --version` reports.

gcloud-go's tags (e.g. `582.0.0`) are not Go module versions, so `go.mod`
records a pseudo-version (`v0.0.0-<date>-<commit>`). `REF=582.0.0` still
works: Go resolves the tag to its commit.

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
- **⧉** next to the box copies the chosen project ID to the clipboard.
- Clicking the box, or pressing `/`, opens a popup below it with three tabs:
  - **Recent**: the last 15 projects you picked, newest first. The popup opens
    on this tab once you have picked any project. ↑/↓ and Enter pick, so
    jumping back to the previous project is `/ ↓ Enter`.
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

## Page state in the URL

The URL query records what is shown, so a page can be reloaded, bookmarked
or shared:

```
http://localhost:8080/?layout=row(prod-a/vms,col:60:40(prod-b/migs,prod-b/scheduler@europe-west2))&layout=dev-x/buckets&active=1
```

```
layout := split | pane
split  := ("row" | "col") (":" size)* "(" layout ("," layout)+ ")"
pane   := [project] ["/" [service] ["@" location]]
```

- **Panes:** each pane is a project and an object type (a service ID from the
  catalogue, e.g. `vms`, `migs`, `buckets`, `scheduler`). Location-scoped
  services add `@location`.
- **Splits:** `row(…)` places panes side by side and `col(…)` stacks them.
  Splits nest. Optional `:size` values are relative weights, one per child.
- **Several layouts:** `layout=` may repeat, one per window or tab. `active=N`
  (0-based) says which one is showing.
- **Validation:**
  - Malformed structure is ignored, and the page falls back to the last
    project.
  - An unknown service, invalid project ID or bad location is dropped from its
    pane only.
  - Limits: 8 levels deep, 32 panes, 16 layouts.
- **History:** picking a project or service adds a browser history entry, so
  Back/Forward hop between views, served from the result cache when fresh.
- **No secrets:** the access token stays in the `#fragment` and is never part
  of the shared query.
- **Not encoded:** hand-typed (non-catalogue) commands. The pane then records
  only the project.

The UI currently shows a single pane: the first pane of the active layout.
Other panes in a shared URL are preserved untouched until multi-pane display
is built.

## Service picker

- The service box sits right of the project box. Tab moves project → service →
  command → Run. Tab closes an open popup on the way.
- Picking a project moves focus to the service box if no service is chosen
  yet.
- The popup has two tabs:
  - **Frequent**: starred services plus any you have used, most used first.
    Buckets, VMs, MIGs, Schedules and Workflows start starred.
  - **All**: the whole catalogue, grouped by category.
- Typing filters the current tab. If nothing in Frequent matches, the popup
  switches to All. ↑/↓ and Enter pick.
- ☆/★ stars or unstars a service. Starred services always appear in Frequent.
- Picking a service fills the command line with its read-only `list` command
  and runs it for the chosen project.
- Some services need a location (Schedules, Workflows, Tasks, Redis, Dataproc,
  KMS, Cloud Deploy). The first time, the command stops at `--location=` for
  you to type one. After that, the last location you used is filled in
  automatically.
- Switching project re-runs the current command, but only if it is exactly a
  catalogue `list` command. Hand-typed commands never re-run on their own.
- Use counts, stars and locations are stored in `localStorage`.

## Cached results

- Picking a service or switching project shows the previous result for that
  project and command if it is less than an hour old, without running gcloud.
- The status line then says `cached 12 min ago · Run to refresh`.
- **Run** always runs gcloud and updates the cache.
- Only the read-only catalogue `list` commands are cached. Results are stored
  per project and exact command (including `--location`).
- Hand-typed commands and failed commands are never cached.
- Results are kept in memory and in `localStorage`, so a reload still uses
  them. The 100 most recent are kept.
- The maximum age is `RESULT_MAX_AGE_MS` in `frontend/src/resultCache.ts`
  (3600 s).

## Console links

In list results, some cells link to the matching Google Cloud console page,
which opens in a new tab. The links are defined per service in
`frontend/src/consoleLinks.ts`:

| Service | Linked columns | Console page |
|---|---|---|
| MIGs | `name`, `baseInstanceName` | `compute/instanceGroups/details/<zone or region>/<name>?tab=overview` |
| VMs | `name` | `compute/instancesDetail/zones/<zone>/instances/<name>` |
| Buckets | `name` | `storage/browser/<bucket>` |
| Schedules | `name` | `cloudscheduler/jobs/edit/<location>/<job>` |
| Workflows | `name` | `workflows/workflow/<location>/<workflow>/executions` |
| Cloud SQL | `name` | `sql/instances/<name>/overview` |
| GKE clusters | `name` | `kubernetes/clusters/details/<location>/<name>/details` |
| Pub/Sub topics, subscriptions | `name` | `cloudpubsub/{topic,subscription}/detail/<id>` |
| Secrets | `name` | `security/secret-manager/secret/<id>/versions` |

- Every URL carries `?project=<project>`.
- Links are built from the command that produced the output, not from
  whatever is currently typed.
- Values from rows are URI-encoded one path segment at a time.

## Result tables

- **Sort:** click a column header to cycle ascending ▲, descending ▼, then off.
  Numbers sort numerically and text sorts naturally (`vm-2` before `vm-10`).
  Empty cells always go last.
- **Resize:** drag the right edge of a header. Long values are cut off with
  `…`; hover to see them in full.
- **Reorder:** drag a header onto another column.
- **Show/hide columns:** the ☰ menu at the start of the header row ticks
  columns on and off. It also has **show all** and **defaults**. At least one
  column stays visible.
- **reset columns** (above the table) restores the default columns, order and
  widths.
- **Filter:** type in the box above the table to show only matching rows.
  - Every visible column is searched, case-insensitively.
  - Space-separated words must all match, but each can match a different
    column, so `web europe` finds `web-1` in `europe-west2-a`.
  - Matches are highlighted, including inside console links.
  - Esc clears the filter.
  - Sorting applies to the filtered rows.
  - The filter is kept when you switch project and cleared when you switch
    service. It is not saved across reloads.

### Defaults

Some services have sensible defaults (`frontend/src/tableDefaults.ts`). Values
are shortened for display: sorting and filtering use the short value, while
console links still use the full value from gcloud.

| Service | Default columns | Shortened | Extras |
|---|---|---|---|
| VMs | name, zone, status | `zone`, `machineType` → last segment (`europe-west1-b`) | ⌨ next to the name copies `gcloud compute ssh --zone ZONE --tunnel-through-iap --project PROJECT NAME` |
| MIGs | name, region, size, targetSize | `region` is computed: the MIG's region, or the region of its zone; `zone`, `instanceTemplate` → last segment | |
| Schedules | name, schedule, state, description | `name` → job ID (after the last `/`) | |

The ⌨ button only appears when the name, zone and project contain nothing but
`a-z 0-9 . : -`. A value from gcloud therefore can never put shell syntax on
your clipboard.

Arrangements are saved in `localStorage`:

| Setting | Remembered per |
|---|---|
| Sort | project and table, e.g. VMs in `prod-a` can sort by zone while MIGs sort by name |
| Visible columns, order and widths | table, shared by every project |

A table is identified by its catalogue service (VMs, MIGs, …). For hand-typed
commands it is identified by the command words without flags, so
`compute instances list --filter=…` shares a layout with
`compute instances list`.
