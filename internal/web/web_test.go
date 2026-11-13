package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/flyingobsidian/gcp-ui/internal/httpmw"
)

var builtAssets = fstest.MapFS{
	"app.js":  {Data: []byte("console.log('app')")},
	"app.css": {Data: []byte("body{}")},
}

func newTestHandler(t *testing.T, assets fstest.MapFS) http.Handler {
	t.Helper()
	h, err := NewHandler(Options{CookieName: "gcpui_token_32000", APIPort: 32000, AllowedHosts: httpmw.LoopbackHosts(8080), Assets: assets})
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	return h
}

func get(h http.Handler, path, host string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	req.Host = host
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestIndex(t *testing.T) {
	rec := get(newTestHandler(t, builtAssets), "/", "localhost:8080")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`content="gcpui_token_32000"`, `content="32000"`, `/static/app.js`, `/static/app.css`, `id="app"`} {
		if !strings.Contains(body, want) {
			t.Errorf("index missing %q", want)
		}
	}
	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "connect-src http://127.0.0.1:32000 http://localhost:32000;") ||
		!strings.Contains(csp, "frame-ancestors 'none'") || strings.Contains(csp, "[::1]") {
		t.Errorf("CSP = %q", csp)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("index must not be cached")
	}
}

func TestIndexWithoutBuild(t *testing.T) {
	rec := get(newTestHandler(t, fstest.MapFS{}), "/", "localhost:8080")
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, "has not been built") || strings.Contains(body, "app.js") {
		t.Errorf("status = %d body = %s", rec.Code, body)
	}
}

func TestStatic(t *testing.T) {
	rec := get(newTestHandler(t, builtAssets), "/static/app.js", "127.0.0.1:8080")
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log('app')" {
		t.Errorf("status = %d body = %q", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
}

func TestRejectsForeignHost(t *testing.T) {
	rec := get(newTestHandler(t, builtAssets), "/", "evil.example:8080")
	if rec.Code != http.StatusMisdirectedRequest {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestUnknownPath(t *testing.T) {
	if rec := get(newTestHandler(t, builtAssets), "/nope", "127.0.0.1:8080"); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestNilAssets(t *testing.T) {
	if _, err := NewHandler(Options{AllowedHosts: httpmw.LoopbackHosts(8080)}); err == nil {
		t.Error("expected an error for nil Assets")
	}
}

func TestEmbeddedAssets(t *testing.T) {
	if _, err := EmbeddedAssets(); err != nil {
		t.Errorf("EmbeddedAssets: %v", err)
	}
}
