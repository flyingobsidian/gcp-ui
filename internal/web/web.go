// Package web serves the browser UI. The page itself holds no secrets: the
// access token arrives in the URL fragment (never sent to the server), and the
// UI copies it into a cookie that the API checks.
package web

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"strconv"
	"strings"

	"github.com/flyingobsidian/gcp-ui/internal/httpmw"
)

//go:embed templates/index.html
var templateFS embed.FS

// dist holds the Vite build of ../../frontend (app.js, app.css). The
// directory is kept in git via .gitkeep so the package compiles before the
// frontend has been built.
//
//go:embed all:dist
var distFS embed.FS

// EmbeddedAssets returns the frontend build compiled into the binary.
func EmbeddedAssets() (fs.FS, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("embedded assets: %w", err)
	}
	return sub, nil
}

// Options configures the web handler.
type Options struct {
	// CookieName is the cookie the UI stores the access token in.
	CookieName   string
	APIPort      int
	AllowedHosts []string
	// Assets is served under /static/ and must contain app.js and app.css
	// for the UI to load.
	Assets fs.FS
}

type pageData struct {
	CookieName string
	APIPort    int
	Built      bool
}

// NewHandler returns the web UI handler.
func NewHandler(opts Options) (http.Handler, error) {
	built, err := hasFile(opts.Assets, "app.js")
	if err != nil {
		return nil, err
	}
	tmpl, err := template.ParseFS(templateFS, "templates/index.html")
	if err != nil {
		return nil, fmt.Errorf("parse index template: %w", err)
	}
	var page bytes.Buffer
	if err := tmpl.Execute(&page, pageData{CookieName: opts.CookieName, APIPort: opts.APIPort, Built: built}); err != nil {
		return nil, fmt.Errorf("render index template: %w", err)
	}

	csp := contentSecurityPolicy(opts.APIPort)
	index := page.Bytes()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Cache-Control", "no-store")
		if _, err := w.Write(index); err != nil {
			return // client went away
		}
	})
	static := http.StripPrefix("/static/", http.FileServerFS(opts.Assets))
	mux.Handle("GET /static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Asset names are fixed (not content-hashed), so make the browser
		// revalidate; FileServer answers with 304 when unchanged.
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	}))

	return httpmw.RequireHost(opts.AllowedHosts, securityHeaders(csp, mux)), nil
}

func hasFile(fsys fs.FS, name string) (bool, error) {
	if fsys == nil {
		return false, errors.New("web: Options.Assets is nil")
	}
	_, err := fs.Stat(fsys, name)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, fs.ErrNotExist):
		return false, nil
	default:
		return false, fmt.Errorf("stat %s: %w", name, err)
	}
}

func contentSecurityPolicy(apiPort int) string {
	// CSP source expressions cannot be IPv6 literals, so [::1] is left out.
	p := strconv.Itoa(apiPort)
	return strings.Join([]string{
		"default-src 'none'",
		"script-src 'self'",
		"style-src 'self'",
		"img-src 'self' data:",
		"connect-src http://127.0.0.1:" + p + " http://localhost:" + p,
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	}, "; ")
}

func securityHeaders(csp string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
