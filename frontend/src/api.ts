// Client for the gcp-ui API. The API port is injected into index.html by the
// Go server; the access token travels as a cookie (see auth.ts).

export interface RunResponse {
  output?: unknown;
  outputText?: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ErrorBody {
  error?: { cause?: string; message?: string; stderr?: string };
}

export class ApiError extends Error {
  readonly kind: string;
  readonly stderr: string;
  readonly status: number;

  constructor(status: number, kind: string, message: string, stderr: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.stderr = stderr;
  }

  // detail is the most useful single line to show a user: gcloud's own
  // ERROR line when present, otherwise the API message.
  get detail(): string {
    const line = this.stderr.split("\n").find((l) => l.startsWith("ERROR:"));
    return line ?? this.message;
  }
}

export const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

const apiBase = `${location.protocol}//${location.hostname}:${meta("gcpui-api-port")}/v1`;

// UNAUTHORIZED is dispatched on window whenever the API rejects the token
// (e.g. gcp-ui restarted with a new one), so the UI can lock itself.
export const UNAUTHORIZED = "gcpui:unauthorized";

async function request(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<RunResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // The API is on another port, so the token cookie is only sent with
  // credentials: "include".
  const resp = await fetch(apiBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
    signal,
  });
  const json = (await resp.json().catch(() => ({}))) as RunResponse & ErrorBody;
  if (resp.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!resp.ok) {
    const e = json.error ?? {};
    throw new ApiError(resp.status, e.cause ?? "http_error", e.message ?? `HTTP ${resp.status}`, e.stderr ?? "");
  }
  return json;
}

// checkSession reports whether the browser holds a valid token. Network
// failures (gcp-ui not running) are thrown.
export async function checkSession(): Promise<boolean> {
  try {
    await request("GET", "/session");
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}

// getList fetches a list endpoint and returns its JSON output.
export async function getList(path: string, signal?: AbortSignal): Promise<unknown> {
  return (await request("GET", path, undefined, signal)).output ?? [];
}

export function runGcloud(args: string[], project: string, signal?: AbortSignal): Promise<RunResponse> {
  return request("POST", "/run", { args, project: project || undefined }, signal);
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return String(err);
}
