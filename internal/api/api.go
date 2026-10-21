// Package api serves the JSON API in front of gcloud.
//
//	POST /v1/run                          {"args": ["compute","instances","list"], "project": "my-proj"}
//	GET  /v1/projects
//	GET  /v1/organizations
//	GET  /v1/organizations/{orgID}/folders
//	GET  /v1/organizations/{orgID}/projects
//	GET  /v1/folders/{folderID}/folders
//	GET  /v1/folders/{folderID}/projects
//	GET  /v1/session                       200 when the caller holds the token
//	GET  /v1/healthz
//
// Every request must carry a loopback Host header. Everything except healthz
// requires the access token: from the web UI as a cookie (see authorized),
// or from scripts as "Authorization: Bearer <token>". Browser requests must
// come from an allowed Origin (the web UI).
package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/flyingobsidian/gcp-ui/internal/gcloud"
	"github.com/flyingobsidian/gcp-ui/internal/httpmw"
	"github.com/flyingobsidian/gcp-ui/internal/resources"
)

const maxBodyBytes = 256 << 10

// Runner executes a gcloud request.
type Runner interface {
	Run(ctx context.Context, req gcloud.Request) (gcloud.Result, error)
}

// Options configures the API handler.
type Options struct {
	Token string
	// CookieName is the cookie the web UI stores the token in.
	CookieName     string
	AllowedHosts   []string
	AllowedOrigins []string
	Logger         *slog.Logger
}

type server struct {
	runner     Runner
	lister     *resources.Lister
	token      []byte
	cookieName string
	origins    map[string]struct{}
	logger     *slog.Logger
}

// NewHandler returns the API handler with host, CORS and token checks applied.
func NewHandler(runner Runner, opts Options) http.Handler {
	s := &server{
		runner:     runner,
		lister:     resources.NewLister(runner),
		token:      []byte(opts.Token),
		cookieName: opts.CookieName,
		origins:    make(map[string]struct{}, len(opts.AllowedOrigins)),
		logger:     opts.Logger,
	}
	for _, o := range opts.AllowedOrigins {
		s.origins[o] = struct{}{}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/healthz", s.handleHealthz)
	authed := func(pattern string, h http.HandlerFunc) { mux.Handle(pattern, s.requireToken(h)) }
	authed("GET /v1/session", s.handleSession)
	authed("POST /v1/run", s.handleRun)
	authed("GET /v1/projects", s.handleAllProjects)
	authed("GET /v1/organizations", s.handleOrganizations)
	authed("GET /v1/organizations/{orgID}/folders", s.handleOrganizationFolders)
	authed("GET /v1/organizations/{orgID}/projects", s.handleOrganizationProjects)
	authed("GET /v1/folders/{folderID}/folders", s.handleFolderFolders)
	authed("GET /v1/folders/{folderID}/projects", s.handleFolderProjects)

	return httpmw.RequireHost(opts.AllowedHosts, s.cors(mux))
}

// cors allows the web UI's origin only. Requests without an Origin header
// (curl, scripts) are not browser cross-site requests and pass through to the
// token check.
func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, ok := s.origins[origin]; !ok {
				writeError(w, http.StatusForbidden, errorBody{Cause: "forbidden_origin", Message: "origin not allowed"})
				return
			}
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			h := w.Header()
			h.Set("Access-Control-Allow-Methods", "GET, POST")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r) {
			writeError(w, http.StatusUnauthorized, errorBody{Cause: "unauthorized", Message: "missing or invalid access token"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// authorized checks the token from an Authorization: Bearer header (scripts)
// or, failing that, from the web UI's cookie. A cookie-authenticated request
// must also carry the web UI's Origin: browsers attach cookies to same-site
// requests a page cannot read (an <img> on another localhost port, say), and
// only the UI's own fetch calls send an allowed Origin.
func (s *server) authorized(r *http.Request) bool {
	if bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return s.tokenMatches(bearer)
	}
	if s.cookieName == "" {
		return false
	}
	c, err := r.Cookie(s.cookieName)
	if err != nil {
		return false
	}
	if _, ok := s.origins[r.Header.Get("Origin")]; !ok {
		return false
	}
	return s.tokenMatches(c.Value)
}

func (s *server) tokenMatches(got string) bool {
	return len(s.token) > 0 && subtle.ConstantTimeCompare([]byte(got), s.token) == 1
}

func (s *server) handleSession(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *server) handleRun(w http.ResponseWriter, r *http.Request) {
	var req runRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, errorBody{Cause: string(gcloud.CauseInvalidRequest), Message: err.Error()})
		return
	}

	res, err := s.runner.Run(r.Context(), gcloud.Request{Args: req.Args, Project: req.Project})
	s.writeResult(w, res, err)
}

func (s *server) handleAllProjects(w http.ResponseWriter, r *http.Request) {
	res, err := s.lister.AllProjects(r.Context())
	s.writeResult(w, res, err)
}

func (s *server) handleOrganizations(w http.ResponseWriter, r *http.Request) {
	res, err := s.lister.Organizations(r.Context())
	s.writeResult(w, res, err)
}

func (s *server) handleOrganizationFolders(w http.ResponseWriter, r *http.Request) {
	org, err := resources.ParseOrganizationID(r.PathValue("orgID"))
	if err != nil {
		s.writeResult(w, gcloud.Result{}, err)
		return
	}
	res, err := s.lister.FoldersInOrganization(r.Context(), org)
	s.writeResult(w, res, err)
}

func (s *server) handleOrganizationProjects(w http.ResponseWriter, r *http.Request) {
	org, err := resources.ParseOrganizationID(r.PathValue("orgID"))
	if err != nil {
		s.writeResult(w, gcloud.Result{}, err)
		return
	}
	res, err := s.lister.ProjectsInOrganization(r.Context(), org)
	s.writeResult(w, res, err)
}

func (s *server) handleFolderFolders(w http.ResponseWriter, r *http.Request) {
	folder, err := resources.ParseFolderID(r.PathValue("folderID"))
	if err != nil {
		s.writeResult(w, gcloud.Result{}, err)
		return
	}
	res, err := s.lister.FoldersInFolder(r.Context(), folder)
	s.writeResult(w, res, err)
}

func (s *server) handleFolderProjects(w http.ResponseWriter, r *http.Request) {
	folder, err := resources.ParseFolderID(r.PathValue("folderID"))
	if err != nil {
		s.writeResult(w, gcloud.Result{}, err)
		return
	}
	res, err := s.lister.ProjectsInFolder(r.Context(), folder)
	s.writeResult(w, res, err)
}

// writeResult writes a successful gcloud result, or maps err to an error response.
func (s *server) writeResult(w http.ResponseWriter, res gcloud.Result, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, toRunResponse(res))
		return
	}
	if errors.Is(err, resources.ErrInvalidID) {
		writeError(w, http.StatusBadRequest, errorBody{Cause: string(gcloud.CauseInvalidRequest), Message: err.Error()})
		return
	}
	var gerr *gcloud.Error
	if !errors.As(err, &gerr) {
		s.logger.Error("unexpected runner error", "err", err)
		writeError(w, http.StatusInternalServerError, errorBody{Cause: "internal", Message: "internal error"})
		return
	}
	body := errorBody{
		Cause:      string(gerr.Cause),
		Message:    gerr.Message,
		Stderr:     gerr.Result.Stderr,
		DurationMs: gerr.Result.Duration.Milliseconds(),
	}
	if gerr.Cause == gcloud.CauseExitStatus {
		code := gerr.Result.ExitCode
		body.ExitCode = &code
	}
	if gerr.Cause == gcloud.CauseStartFailed {
		s.logger.Error("gcloud failed to start", "err", gerr)
	}
	writeError(w, statusFor(gerr.Cause), body)
}

func statusFor(c gcloud.Cause) int {
	switch c {
	case gcloud.CauseInvalidRequest:
		return http.StatusBadRequest
	case gcloud.CauseExitStatus, gcloud.CauseOutputTooLarge:
		return http.StatusBadGateway
	case gcloud.CauseTimeout:
		return http.StatusGatewayTimeout
	case gcloud.CauseCancelled:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func toRunResponse(res gcloud.Result) runResponse {
	out := runResponse{
		Stderr:     res.Stderr,
		ExitCode:   res.ExitCode,
		DurationMs: res.Duration.Milliseconds(),
	}
	trimmed := bytes.TrimSpace(res.Stdout)
	switch {
	case len(trimmed) == 0:
	case json.Valid(trimmed):
		out.Output = json.RawMessage(trimmed)
	default:
		out.OutputText = string(res.Stdout)
	}
	return out
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	// The status line is already sent; an encode error here means the client went away.
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, body errorBody) {
	writeJSON(w, status, errorResponse{Error: body})
}
