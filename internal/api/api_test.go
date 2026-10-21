package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/flyingobsidian/gcp-ui/internal/gcloud"
	"github.com/flyingobsidian/gcp-ui/internal/httpmw"
)

const (
	testToken  = "secret-token"
	testCookie = "gcpui_token_32000"
)

type fakeRunner struct {
	res  gcloud.Result
	err  error
	got  gcloud.Request
	runs int
}

func (f *fakeRunner) Run(_ context.Context, req gcloud.Request) (gcloud.Result, error) {
	f.got = req
	f.runs++
	return f.res, f.err
}

func newTestHandler(runner Runner) http.Handler {
	return NewHandler(runner, Options{
		Token:          testToken,
		CookieName:     testCookie,
		AllowedHosts:   httpmw.LoopbackHosts(32000),
		AllowedOrigins: httpmw.LoopbackOrigins(8080),
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

type reqOpt func(*http.Request)

func withHeader(k, v string) reqOpt { return func(r *http.Request) { r.Header.Set(k, v) } }
func withHost(h string) reqOpt      { return func(r *http.Request) { r.Host = h } }

func do(t *testing.T, h http.Handler, method, path, body string, opts ...reqOpt) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:32000"
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("Content-Type", "application/json")
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestRunSuccessJSON(t *testing.T) {
	runner := &fakeRunner{res: gcloud.Result{Stdout: []byte("[{\"name\":\"vm-1\"}]\n"), Duration: 42 * time.Millisecond}}
	rec := do(t, newTestHandler(runner), "POST", "/v1/run", `{"args":["compute","instances","list"],"project":"my-project"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	resp := decode[runResponse](t, rec)
	if string(resp.Output) != `[{"name":"vm-1"}]` || resp.DurationMs != 42 || resp.OutputText != "" {
		t.Errorf("unexpected response %+v", resp)
	}
	if !slices.Equal(runner.got.Args, []string{"compute", "instances", "list"}) || runner.got.Project != "my-project" {
		t.Errorf("runner got %+v", runner.got)
	}
}

func TestRunSuccessText(t *testing.T) {
	runner := &fakeRunner{res: gcloud.Result{Stdout: []byte("not json\n")}}
	rec := do(t, newTestHandler(runner), "POST", "/v1/run", `{"args":["x"]}`)
	resp := decode[runResponse](t, rec)
	if resp.Output != nil || resp.OutputText != "not json\n" {
		t.Errorf("unexpected response %+v", resp)
	}
}

func TestRunErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		cause  string
	}{
		{"exit status", &gcloud.Error{Cause: gcloud.CauseExitStatus, Result: gcloud.Result{Stderr: "ERROR: denied", ExitCode: 1}}, http.StatusBadGateway, "exit_status"},
		{"invalid", &gcloud.Error{Cause: gcloud.CauseInvalidRequest}, http.StatusBadRequest, "invalid_request"},
		{"timeout", &gcloud.Error{Cause: gcloud.CauseTimeout}, http.StatusGatewayTimeout, "timeout"},
		{"start failed", &gcloud.Error{Cause: gcloud.CauseStartFailed}, http.StatusInternalServerError, "start_failed"},
		{"unexpected", io.ErrUnexpectedEOF, http.StatusInternalServerError, "internal"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, newTestHandler(&fakeRunner{err: tt.err}), "POST", "/v1/run", `{"args":["x"]}`)
			if rec.Code != tt.status {
				t.Errorf("status = %d, want %d", rec.Code, tt.status)
			}
			if got := decode[errorResponse](t, rec).Error.Cause; got != tt.cause {
				t.Errorf("cause = %q, want %q", got, tt.cause)
			}
		})
	}
}

func TestRunExitStatusIncludesStderr(t *testing.T) {
	err := &gcloud.Error{Cause: gcloud.CauseExitStatus, Result: gcloud.Result{Stderr: "ERROR: denied", ExitCode: 1}}
	rec := do(t, newTestHandler(&fakeRunner{err: err}), "POST", "/v1/run", `{"args":["x"]}`)
	body := decode[errorResponse](t, rec).Error
	if body.Stderr != "ERROR: denied" || body.ExitCode == nil || *body.ExitCode != 1 {
		t.Errorf("unexpected error body %+v", body)
	}
}

func TestRunRejectsBadBodies(t *testing.T) {
	for name, body := range map[string]string{
		"not json":      `nope`,
		"unknown field": `{"args":["x"],"shell":true}`,
		"two objects":   `{"args":["x"]}{"args":["y"]}`,
	} {
		t.Run(name, func(t *testing.T) {
			runner := &fakeRunner{}
			rec := do(t, newTestHandler(runner), "POST", "/v1/run", body)
			if rec.Code != http.StatusBadRequest || runner.runs != 0 {
				t.Errorf("status = %d, runs = %d", rec.Code, runner.runs)
			}
		})
	}
}

func TestAuthAndOrigin(t *testing.T) {
	tests := []struct {
		name   string
		opts   []reqOpt
		status int
	}{
		{"no token", []reqOpt{withHeader("Authorization", "")}, http.StatusUnauthorized},
		{"wrong token", []reqOpt{withHeader("Authorization", "Bearer nope")}, http.StatusUnauthorized},
		{"foreign origin", []reqOpt{withHeader("Origin", "https://evil.example")}, http.StatusForbidden},
		{"rebinding host", []reqOpt{withHost("evil.example:32000")}, http.StatusMisdirectedRequest},
		{"allowed origin", []reqOpt{withHeader("Origin", "http://localhost:8080")}, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &fakeRunner{res: gcloud.Result{Stdout: []byte("[]")}}
			rec := do(t, newTestHandler(runner), "POST", "/v1/run", `{"args":["x"]}`, tt.opts...)
			if rec.Code != tt.status {
				t.Errorf("status = %d, want %d", rec.Code, tt.status)
			}
			if tt.status != http.StatusOK && runner.runs != 0 {
				t.Errorf("runner was called on a rejected request")
			}
		})
	}
}

func TestCookieAuth(t *testing.T) {
	const uiOrigin = "http://localhost:8080"
	cookie := func(v string) reqOpt { return withHeader("Cookie", testCookie+"="+v) }
	noBearer := withHeader("Authorization", "")
	tests := []struct {
		name   string
		opts   []reqOpt
		status int
	}{
		{"cookie from ui", []reqOpt{noBearer, cookie(testToken), withHeader("Origin", uiOrigin)}, http.StatusOK},
		{"wrong cookie", []reqOpt{noBearer, cookie("nope"), withHeader("Origin", uiOrigin)}, http.StatusUnauthorized},
		{"empty cookie", []reqOpt{noBearer, cookie(""), withHeader("Origin", uiOrigin)}, http.StatusUnauthorized},
		{"other cookie name", []reqOpt{noBearer, withHeader("Cookie", "gcpui_token_1="+testToken), withHeader("Origin", uiOrigin)}, http.StatusUnauthorized},
		{"cookie without origin", []reqOpt{noBearer, cookie(testToken)}, http.StatusUnauthorized},
		{"cookie from foreign origin", []reqOpt{noBearer, cookie(testToken), withHeader("Origin", "http://localhost:9999")}, http.StatusForbidden},
		{"wrong bearer beats good cookie", []reqOpt{withHeader("Authorization", "Bearer nope"), cookie(testToken), withHeader("Origin", uiOrigin)}, http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &fakeRunner{res: gcloud.Result{Stdout: []byte("[]")}}
			rec := do(t, newTestHandler(runner), "GET", "/v1/projects", "", tt.opts...)
			if rec.Code != tt.status {
				t.Errorf("status = %d, want %d (%s)", rec.Code, tt.status, rec.Body)
			}
			if tt.status != http.StatusOK && runner.runs != 0 {
				t.Errorf("gcloud ran for a rejected request")
			}
		})
	}
}

func TestCredentialedCORS(t *testing.T) {
	rec := do(t, newTestHandler(&fakeRunner{}), "GET", "/v1/session", "", withHeader("Origin", "http://127.0.0.1:8080"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" ||
		rec.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" {
		t.Errorf("CORS headers = %v", rec.Header())
	}
}

func TestSessionRequiresToken(t *testing.T) {
	rec := do(t, newTestHandler(&fakeRunner{}), "GET", "/v1/session", "", withHeader("Authorization", ""))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestEmptyServerTokenRejectsEverything(t *testing.T) {
	h := NewHandler(&fakeRunner{}, Options{
		CookieName:     testCookie,
		AllowedHosts:   httpmw.LoopbackHosts(32000),
		AllowedOrigins: httpmw.LoopbackOrigins(8080),
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	rec := do(t, h, "GET", "/v1/session", "", withHeader("Authorization", "Bearer "))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestPreflight(t *testing.T) {
	rec := do(t, newTestHandler(&fakeRunner{}), "OPTIONS", "/v1/run", "",
		withHeader("Authorization", ""), withHeader("Origin", "http://127.0.0.1:8080"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:8080" {
		t.Errorf("Allow-Origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Authorization") {
		t.Errorf("Allow-Headers = %q", got)
	}
}

func TestHierarchyRoutes(t *testing.T) {
	tests := []struct {
		path string
		want []string
	}{
		{"/v1/projects", []string{"projects", "list"}},
		{"/v1/organizations", []string{"organizations", "list"}},
		{"/v1/organizations/123456789012/folders", []string{"resource-manager", "folders", "list", "--organization=123456789012"}},
		{"/v1/organizations/123456789012/projects", []string{"projects", "list", "--organization=123456789012"}},
		{"/v1/folders/987/folders", []string{"resource-manager", "folders", "list", "--folder=987"}},
		{"/v1/folders/987/projects", []string{"projects", "list", "--folder=987"}},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			runner := &fakeRunner{res: gcloud.Result{Stdout: []byte("null\n")}}
			rec := do(t, newTestHandler(runner), "GET", tt.path, "")
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d: %s", rec.Code, rec.Body)
			}
			if !slices.Equal(runner.got.Args, tt.want) || runner.got.Project != "" {
				t.Errorf("runner got %+v, want args %q", runner.got, tt.want)
			}
			if out := decode[runResponse](t, rec).Output; string(out) != "[]" {
				t.Errorf("output = %s, want [] for empty list", out)
			}
		})
	}
}

func TestHierarchyRejectsInvalidIDs(t *testing.T) {
	paths := []string{
		"/v1/organizations/abc/folders",
		"/v1/organizations/0/folders",
		"/v1/organizations/-1/folders",
		"/v1/organizations/organizations%2F123/folders",
		"/v1/organizations/abc/projects",
		"/v1/organizations/1;id/projects",
		"/v1/folders/--flags-file=x/folders",
		"/v1/folders/12%0A/projects",
		"/v1/folders/1%202/projects",
		"/v1/folders/12345678901234567890/projects",
	}
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			runner := &fakeRunner{}
			rec := do(t, newTestHandler(runner), "GET", p, "")
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (%s)", rec.Code, rec.Body)
			}
			if got := decode[errorResponse](t, rec).Error.Cause; got != "invalid_request" {
				t.Errorf("cause = %q", got)
			}
			if runner.runs != 0 {
				t.Errorf("gcloud was invoked for %s", p)
			}
		})
	}
}

func TestHierarchyRequiresToken(t *testing.T) {
	runner := &fakeRunner{}
	rec := do(t, newTestHandler(runner), "GET", "/v1/folders/1/projects", "", withHeader("Authorization", ""))
	if rec.Code != http.StatusUnauthorized || runner.runs != 0 {
		t.Errorf("status = %d, runs = %d", rec.Code, runner.runs)
	}
}

func TestHierarchyGcloudError(t *testing.T) {
	err := &gcloud.Error{Cause: gcloud.CauseExitStatus, Result: gcloud.Result{Stderr: "ERROR: PERMISSION_DENIED", ExitCode: 1}}
	rec := do(t, newTestHandler(&fakeRunner{err: err}), "GET", "/v1/folders/1/folders", "")
	body := decode[errorResponse](t, rec).Error
	if rec.Code != http.StatusBadGateway || body.Stderr != "ERROR: PERMISSION_DENIED" {
		t.Errorf("status = %d body = %+v", rec.Code, body)
	}
}

func TestHealthzNeedsNoToken(t *testing.T) {
	rec := do(t, newTestHandler(&fakeRunner{}), "GET", "/v1/healthz", "", withHeader("Authorization", ""))
	if rec.Code != http.StatusOK || decode[healthResponse](t, rec).Status != "ok" {
		t.Errorf("status = %d body = %s", rec.Code, rec.Body)
	}
}
