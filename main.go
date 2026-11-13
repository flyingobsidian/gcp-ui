// Command gcp-ui serves a localhost-only web UI for GCP and an API that passes
// commands through to gcloud with JSON output. gcloud is gcloud-go, linked
// into this binary: each command runs in a re-executed copy of gcp-ui (see
// internal/gcloudgo).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/flyingobsidian/gcp-ui/internal/api"
	"github.com/flyingobsidian/gcp-ui/internal/config"
	"github.com/flyingobsidian/gcp-ui/internal/gcloud"
	"github.com/flyingobsidian/gcp-ui/internal/gcloudgo"
	"github.com/flyingobsidian/gcp-ui/internal/httpmw"
	"github.com/flyingobsidian/gcp-ui/internal/session"
	"github.com/flyingobsidian/gcp-ui/internal/web"
)

const shutdownTimeout = 5 * time.Second

func main() {
	if gcloudgo.IsChild() {
		os.Exit(gcloudgo.Main())
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "gcp-ui:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Args[1:], os.Getenv, os.Stderr)
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	self, err := gcloudgo.Executable()
	if err != nil {
		return err
	}
	token, err := session.NewToken()
	if err != nil {
		return err
	}
	cookieName := session.CookieName(cfg.APIPort)

	runner := gcloud.NewRunner(self, gcloudgo.ChildEnv(), cfg.CommandTimeout, cfg.MaxConcurrent)
	apiHandler := api.NewHandler(runner, api.Options{
		Token:          token,
		CookieName:     cookieName,
		AllowedHosts:   httpmw.LoopbackHosts(cfg.APIPort),
		AllowedOrigins: httpmw.LoopbackOrigins(cfg.WebPort),
		Logger:         logger,
	})
	assets, err := web.EmbeddedAssets()
	if err != nil {
		return err
	}
	webHandler, err := web.NewHandler(web.Options{
		CookieName:   cookieName,
		APIPort:      cfg.APIPort,
		AllowedHosts: httpmw.LoopbackHosts(cfg.WebPort),
		Assets:       assets,
	})
	if err != nil {
		return err
	}

	servers := []*namedServer{
		newServer("web", cfg.BindHost, cfg.WebPort, httpmw.LogRequests(logger, "web", webHandler), 30*time.Second),
		newServer("api", cfg.BindHost, cfg.APIPort, httpmw.LogRequests(logger, "api", apiHandler), cfg.CommandTimeout+10*time.Second),
	}

	// Bind both ports before announcing anything, so a port clash fails fast.
	for _, s := range servers {
		if err := s.listen(); err != nil {
			closeAll(servers)
			return err
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, len(servers))
	for _, s := range servers {
		go func() { errc <- s.serve() }()
	}
	logger.Info("gcp-ui ready",
		"web", servers[0].srv.Addr,
		"api", servers[1].srv.Addr,
		"gcloud_go", gcloudgo.Version())
	// The token goes in the fragment, which browsers never send to a server,
	// so it stays out of request lines, logs and Referer headers.
	fmt.Fprintf(os.Stderr, "\nopen http://%s/#%s\n\n",
		net.JoinHostPort(browserHost(cfg.BindHost), strconv.Itoa(cfg.WebPort)), token)

	var serveErr error
	select {
	case <-ctx.Done():
		logger.Info("shutting down")
	case serveErr = <-errc:
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	var errs []error
	if serveErr != nil {
		errs = append(errs, serveErr)
	}
	for _, s := range servers {
		if err := s.srv.Shutdown(shutdownCtx); err != nil {
			errs = append(errs, fmt.Errorf("shutdown %s server: %w", s.name, err))
		}
	}
	return errors.Join(errs...)
}

type namedServer struct {
	name string
	srv  *http.Server
	ln   net.Listener
}

func newServer(name, host string, port int, h http.Handler, writeTimeout time.Duration) *namedServer {
	return &namedServer{
		name: name,
		srv: &http.Server{
			Addr:              net.JoinHostPort(host, strconv.Itoa(port)),
			Handler:           h,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       2 * time.Minute,
		},
	}
}

func (s *namedServer) listen() error {
	ln, err := net.Listen("tcp", s.srv.Addr)
	if err != nil {
		return fmt.Errorf("listen %s server on %s: %w", s.name, s.srv.Addr, err)
	}
	s.ln = ln
	return nil
}

func (s *namedServer) serve() error {
	if err := s.srv.Serve(s.ln); !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("%s server: %w", s.name, err)
	}
	return nil
}

func closeAll(servers []*namedServer) {
	for _, s := range servers {
		if s.ln != nil {
			// Startup is already failing; the listen error is the one worth reporting.
			_ = s.ln.Close()
		}
	}
}

// browserHost is the host to put in the printed URL: "localhost" for the
// default bind address, otherwise the bind address itself.
func browserHost(bind string) string {
	if bind == config.DefaultBindHost {
		return "localhost"
	}
	return bind
}
