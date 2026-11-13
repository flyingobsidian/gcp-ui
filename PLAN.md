# gcp-ui — plan (draft 2, 2026-10-20)

A fast, localhost-only web UI for GCP. A Go backend runs `gcloud … --format json`
and a Preact frontend renders the results. It's built for working across many
projects at once.

## Context

- **One gcloud account.** There's no per-pane account switching or impersonation.
- **78 projects:** 55 prod, 3 demo, 10 test, 10 dev. Lists are usually 100 rows
  or fewer.
- **Priority resources:** VMs, MIGs, buckets, Cloud Scheduler jobs, Workflows,
  workflow executions.
- **Events:** audit logs and general Cloud Logging only. No Monitoring
  alerts or incidents.
- **Frontend:** Preact.

## Goals

1. **Multi-project first.** Tabs, and split panes inside each tab. Every pane is
   bound to a project, or to a project *group* such as "all prod".
2. **Fast.** No docs panels, AI widgets or marketing chrome. The first paint is
   an empty shell. Data loads only for the panes on screen. Results are cached
   and refreshed in the background.
3. **Localhost only, safe by default.** It holds your gcloud credentials, so it
   has to resist hostile browser tabs (CSRF and DNS rebinding).
4. **Read-mostly.** v1 lists and describes resources and shows events. Mutations
   come later and need explicit confirmation.

## Non-goals (v1)

- Re-implementing the Console's create/edit wizards.
- Remote or multi-user access.
- Multiple accounts or impersonation.
- Monitoring alerts and incidents.
- Calling GCP APIs directly. `gcloud` is the only data source for now (see "Later").

## Architecture

```
Browser (Preact SPA, from :8080)  ──HTTP/SSE──▶  gcp-ui API (127.0.0.1:32000)  ──exec argv──▶  gcloud … --project P --format json
   tabs/panes                                     view registry + cache + scheduler
```

Single static Go binary with the Vite-built frontend embedded (`embed.FS`). It
serves the web UI on one port (default 8080) and the API on another (default
32000); both ports are configurable. Start it with `gcp-ui` and open the
printed URL.

**Status (2026-10-20):**
- The boilerplate is in place. `POST /v1/run` is a generic passthrough taking
  an argv list. The view registry, cache and scheduler will sit in front of it,
  and the passthrough can stay as an escape hatch.
- Typed hierarchy endpoints exist: orgs, folders, projects-in-org,
  projects-in-folder, and all projects.
- The Preact frontend has a project picker with a cached tree and search, plus
  one command pane. Caching is client-side for now; there is no backend cache
  yet.

### Backend (Go)

- **View registry, not a shell.** Each view is a named template, e.g.
  `compute.instances.list → ["compute","instances","list"]`, with typed allowed
  params (location, filter, limit, workflow…). The client sends
  `{view, project | group, params}` and never raw argv. Run via `exec.Command`
  with an argv slice. Never use `sh -c`.
- **Always inject** `--project=P --format=json --quiet`, and run with
  `CLOUDSDK_CORE_DISABLE_PROMPTS=1`. Never use `gcloud config set`: that's
  global state and would race between panes.
- **Binary:** gcloud-go is linked in as a Go module and run in a re-executed
  copy of gcp-ui (decided 2026-10-21; see README "gcloud"). It costs about
  50 ms CPU per invocation. With 78 projects, process startup cost multiplies,
  so gcloud-go matters a lot here.
- **Cache:** key = (view, project, params). Serve stale-while-revalidate with a
  TTL per view: VMs/MIGs ~30 s, executions ~15 s, buckets/scheduler/workflows
  ~5 min, projects ~1 h. An in-memory LRU, plus an on-disk snapshot so a restart
  paints instantly from the last known data.
- **Scheduler:** a global concurrency cap (start at 12, tunable) and a per-project
  cap of 2. Identical in-flight requests are deduplicated (singleflight).
  Requests are cancelled when their pane goes away. If GCP returns quota or
  rate-limit errors, it backs off and retries with jitter.
- **Streaming:** use SSE for log panes. Poll `logging read --freshness` with a
  cursor (the last timestamp/insertId) rather than `logging tail`.
- **Errors:** capture stderr, classify it (auth expired, API not enabled,
  permission denied, not found) and return a structured error. "API not
  enabled" is expected in many projects, for example ones without Workflows. It
  shows as a quiet grey "n/a" cell, not a red error.
- **Security:**
  - Bind to `127.0.0.1` only.
  - Generate a random token at startup, put it in the printed URL, and require
    it on every API call as a cookie plus a header.
  - Check `Host` and `Origin` on every request.
  - Mutating views go in a separate registry and are off by default.

### Projects and groups

- Seed the project list from `gcloud projects list`.
- Assign each project a tier (prod / demo / test / dev). Derive it automatically
  from a project label or a name pattern, or set it by hand in a small config
  file (`~/.config/gcp-ui/projects.yaml`).
- Every tier is a **group**, and user-defined groups are allowed too. A pane can
  target a group and runs the view across all its members.
- Tiers have fixed colours, with red for prod. The pane header always shows the
  project ID or group name.

### Cross-project ("group") panes

This is the big multi-project win, and also the biggest speed risk: "all prod
VMs" is 55 gcloud calls.

- **Default:** fan out per project through the scheduler. Rows stream into the
  table as each project returns, rather than waiting for the slowest one. A
  per-project status strip shows ok / loading / n/a / error.
- **Fast path to evaluate (spike):** `gcloud asset search-all-resources
  --scope=organizations/ORG` (or a folder) with `--asset-types=` for VMs, MIGs,
  buckets, scheduler jobs and workflows. This is one call for every project, at
  the cost of Asset Inventory freshness lag (seconds to minutes) and a less
  complete field set. It could fill the list instantly, with per-project calls
  then filling in live detail. Needs `cloudasset.googleapis.com` and org/folder
  permission.

### Regional resources

Scheduler jobs and Workflows are per-location. In order of preference:

1. Use the `--location=-` wildcard where the API supports it (to verify in the
   spike for scheduler, workflows and workflow executions).
2. Otherwise find the locations each project uses (from Asset Inventory, or
   probing the regions you use, from a config list) and cache them for a long
   time.

Workflow executions: list per workflow (`--workflow=W --location=L`, newest
first, `--limit`). A group-level "recent failed executions" pane needs a fan-out
over every workflow, which is a strong candidate for the cache and on-disk
snapshot.

### Frontend (Preact)

- **Stack:** TypeScript + Preact + `@preact/signals` + Vite. The target is
  under 60 KB gzipped. No UI kit; hand-written CSS with a dense, terminal-ish
  look. With lists of 100 rows or fewer, plain tables are fine and no
  virtualisation is needed. Group panes (55 × N rows) may need it, so measure
  first.
- **Workspace model:** a Workspace has Tabs. Each Tab is a tiling split tree,
  like tmux or VS Code editor groups. Each Pane has
  `{target: project|group, view, params}`. Layouts are kept in localStorage and
  can be exported as JSON. Named workspaces are supported, e.g. "prod-oncall".
- **Rendering JSON:**
  - Lists: a table with per-view column presets, with a fallback of inferred
    scalar fields. Sort, filter and show/hide columns all happen client-side. A
    `project` column is added in group panes.
  - Detail: a collapsible JSON tree with copy-path and copy-value.
  - A raw JSON toggle on every pane.
- **Navigation:** a command palette (Ctrl-K) for target → view, with fuzzy match
  over all 78 project IDs and the groups. Keyboard pane focus and splits.
  Clicking a row opens describe in a side drawer or a new split. A per-pane
  refresh button and an "age of data" indicator.

## View catalogue (priority order)

| # | Area | Views |
|---|---|---|
| 1 | VMs | `compute instances list` / `describe` |
| 2 | MIGs | `compute instance-groups managed list` / `describe` / `list-instances` |
| 3 | Buckets | `storage buckets list` / `describe` |
| 4 | Scheduler | `scheduler jobs list` / `describe` (per location) |
| 5 | Workflows | `workflows list` / `describe` (per location) |
| 6 | Executions | `workflows executions list` / `describe` (per workflow) |
| 7 | Audit logs | `logging read` on `cloudaudit.googleapis.com%2Factivity` (and optionally `data_access`, `system_event`), streamed |
| 8 | Logs | `logging read` with a free-form filter, severity picker, resource-type picker, streamed |
| — | Projects | `projects list` / `describe` (for navigation) |

All of these are present in gcloud-go today (checked 2026-10-20).

Log panes are scoped to a project or a group. A group log pane fans out the
same filter and merges the results by timestamp.

## Milestones

1. **Spike (½ day).** Check the `--location=-` support, the Asset Inventory
   fast path, and the timing for a 55-project fan-out with gcloud-go. Report the
   numbers before going further.
2. **Skeleton.** Go server with token auth, the registry with VMs and buckets,
   the cache and scheduler, and an embedded Preact SPA with one pane rendering a
   table/tree. Measure: warm pane under 100 ms.
3. **Workspace.** Tabs, splits, the projects config with tiers and colours,
   groups, command palette, persisted layouts.
4. **Catalogue.** MIGs, scheduler, workflows and executions, with column
   presets, error classification and the on-disk snapshot.
5. **Logs.** Audit log and general log panes over SSE, for single projects and
   groups.
6. **(Later)** Opt-in mutations (VM start/stop, MIG resize, run a scheduler job
   now, execute a workflow) with a typed confirmation of the project ID.

## Later / open ideas

- A direct API backend (Go client libraries) behind the same registry
  interface, if gcloud exec becomes the bottleneck for group panes.
- Saved filters, and diffing two snapshots of a list ("what changed in prod VMs
  since this morning").

## Open questions

1. Is there one organisation (or folder) above all 78 projects that you can run
   Asset Inventory searches against?
2. How are the tiers identifiable: a label, a naming convention, folders, or a
   hand-maintained list?
3. Which regions do you use (to bound the location fan-out for scheduler and
   workflows)?
