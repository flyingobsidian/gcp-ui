// Package httpmw holds HTTP middleware shared by the web and API servers.
package httpmw

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

// LoopbackHosts returns the Host header values a browser sends for a loopback
// server on port.
func LoopbackHosts(port int) []string {
	p := strconv.Itoa(port)
	return []string{"127.0.0.1:" + p, "localhost:" + p, "[::1]:" + p}
}

// LoopbackOrigins returns the Origin header values for pages served from a
// loopback server on port.
func LoopbackOrigins(port int) []string {
	hosts := LoopbackHosts(port)
	origins := make([]string, len(hosts))
	for i, h := range hosts {
		origins[i] = "http://" + h
	}
	return origins
}

// RequireHost rejects requests whose Host header is not in allowed. Combined
// with a loopback-only listener this defeats DNS-rebinding attacks, where a
// hostile site points its own hostname at 127.0.0.1.
func RequireHost(allowed []string, next http.Handler) http.Handler {
	set := toSet(allowed)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := set[r.Host]; !ok {
			http.Error(w, "unrecognised host", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// LogRequests logs one line per request.
func LogRequests(logger *slog.Logger, server string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rec, r)
		logger.Info("request",
			"server", server,
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func toSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, v := range values {
		set[v] = struct{}{}
	}
	return set
}
