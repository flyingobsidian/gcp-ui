// Package config loads gcp-ui settings from command-line flags, falling back
// to GCPUI_* environment variables and then to built-in defaults.
package config

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"
)

// Config holds runtime settings for both servers and the gcloud runner.
type Config struct {
	BindHost       string
	WebPort        int
	APIPort        int
	GcloudPath     string
	CommandTimeout time.Duration
	MaxConcurrent  int
}

// Defaults used when neither a flag nor an environment variable is set.
const (
	DefaultBindHost       = "127.0.0.1"
	DefaultWebPort        = 8080
	DefaultAPIPort        = 32000
	DefaultGcloudPath     = "gcloud"
	DefaultCommandTimeout = 2 * time.Minute
	DefaultMaxConcurrent  = 8
)

// ErrInvalid is wrapped by every validation failure returned from Load.
var ErrInvalid = errors.New("invalid configuration")

// Load parses args (without the program name). getenv is normally os.Getenv.
// Help output and flag errors are written to output. It returns flag.ErrHelp
// when -h/--help was requested.
func Load(args []string, getenv func(string) string, output io.Writer) (Config, error) {
	defaults, err := envDefaults(getenv)
	if err != nil {
		return Config{}, err
	}

	fs := flag.NewFlagSet("gcp-ui", flag.ContinueOnError)
	fs.SetOutput(output)
	cfg := Config{}
	fs.StringVar(&cfg.BindHost, "bind", defaults.BindHost, "loopback address to listen on (env GCPUI_BIND)")
	fs.IntVar(&cfg.WebPort, "web-port", defaults.WebPort, "port serving the web UI (env GCPUI_WEB_PORT)")
	fs.IntVar(&cfg.APIPort, "api-port", defaults.APIPort, "port serving the gcloud API (env GCPUI_API_PORT)")
	fs.StringVar(&cfg.GcloudPath, "gcloud", defaults.GcloudPath, "gcloud binary name or path (env GCPUI_GCLOUD)")
	fs.DurationVar(&cfg.CommandTimeout, "timeout", defaults.CommandTimeout, "per-command timeout (env GCPUI_TIMEOUT)")
	fs.IntVar(&cfg.MaxConcurrent, "max-concurrent", defaults.MaxConcurrent, "maximum concurrent gcloud processes (env GCPUI_MAX_CONCURRENT)")
	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}
	if fs.NArg() > 0 {
		return Config{}, fmt.Errorf("%w: unexpected arguments %q", ErrInvalid, fs.Args())
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func envDefaults(getenv func(string) string) (Config, error) {
	cfg := Config{
		BindHost:       DefaultBindHost,
		WebPort:        DefaultWebPort,
		APIPort:        DefaultAPIPort,
		GcloudPath:     DefaultGcloudPath,
		CommandTimeout: DefaultCommandTimeout,
		MaxConcurrent:  DefaultMaxConcurrent,
	}
	if v := getenv("GCPUI_BIND"); v != "" {
		cfg.BindHost = v
	}
	if v := getenv("GCPUI_GCLOUD"); v != "" {
		cfg.GcloudPath = v
	}
	for _, e := range []struct {
		name string
		dst  *int
	}{
		{"GCPUI_WEB_PORT", &cfg.WebPort},
		{"GCPUI_API_PORT", &cfg.APIPort},
		{"GCPUI_MAX_CONCURRENT", &cfg.MaxConcurrent},
	} {
		v := getenv(e.name)
		if v == "" {
			continue
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, fmt.Errorf("%w: %s=%q is not an integer", ErrInvalid, e.name, v)
		}
		*e.dst = n
	}
	if v := getenv("GCPUI_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("%w: GCPUI_TIMEOUT=%q is not a duration", ErrInvalid, v)
		}
		cfg.CommandTimeout = d
	}
	return cfg, nil
}

func (c Config) validate() error {
	if !IsLoopback(c.BindHost) {
		return fmt.Errorf("%w: bind address %q is not a loopback address", ErrInvalid, c.BindHost)
	}
	for _, p := range []struct {
		name string
		port int
	}{{"web port", c.WebPort}, {"api port", c.APIPort}} {
		if p.port < 1 || p.port > 65535 {
			return fmt.Errorf("%w: %s %d out of range 1-65535", ErrInvalid, p.name, p.port)
		}
	}
	if c.WebPort == c.APIPort {
		return fmt.Errorf("%w: web port and api port must differ (both %d)", ErrInvalid, c.WebPort)
	}
	if c.GcloudPath == "" {
		return fmt.Errorf("%w: gcloud path is empty", ErrInvalid)
	}
	if c.CommandTimeout <= 0 {
		return fmt.Errorf("%w: timeout must be positive", ErrInvalid)
	}
	if c.MaxConcurrent < 1 {
		return fmt.Errorf("%w: max-concurrent must be at least 1", ErrInvalid)
	}
	return nil
}

// IsLoopback reports whether host is "localhost" or a loopback IP literal.
func IsLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
