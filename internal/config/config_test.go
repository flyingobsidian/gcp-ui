package config

import (
	"errors"
	"flag"
	"io"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(nil, env(nil), io.Discard)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		BindHost:       DefaultBindHost,
		WebPort:        DefaultWebPort,
		APIPort:        DefaultAPIPort,
		CommandTimeout: DefaultCommandTimeout,
		MaxConcurrent:  DefaultMaxConcurrent,
	}
	if cfg != want {
		t.Errorf("got %+v, want %+v", cfg, want)
	}
}

func TestLoadEnvThenFlags(t *testing.T) {
	e := env(map[string]string{
		"GCPUI_WEB_PORT":       "9000",
		"GCPUI_API_PORT":       "9001",
		"GCPUI_TIMEOUT":        "30s",
		"GCPUI_MAX_CONCURRENT": "3",
	})
	cfg, err := Load([]string{"--api-port", "9100"}, e, io.Discard)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.WebPort != 9000 || cfg.APIPort != 9100 || cfg.CommandTimeout != 30*time.Second ||
		cfg.MaxConcurrent != 3 {
		t.Errorf("unexpected config %+v", cfg)
	}
}

func TestLoadInvalid(t *testing.T) {
	tests := []struct {
		name string
		args []string
		env  map[string]string
	}{
		{"non-loopback bind", []string{"--bind", "0.0.0.0"}, nil},
		{"lan bind", []string{"--bind", "192.168.1.5"}, nil},
		{"same ports", []string{"--web-port", "9000", "--api-port", "9000"}, nil},
		{"port range", []string{"--web-port", "70000"}, nil},
		{"zero timeout", []string{"--timeout", "0s"}, nil},
		{"zero concurrency", []string{"--max-concurrent", "0"}, nil},
		{"bad env int", nil, map[string]string{"GCPUI_WEB_PORT": "eighty"}},
		{"bad env duration", nil, map[string]string{"GCPUI_TIMEOUT": "soon"}},
		{"positional args", []string{"extra"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(tt.args, env(tt.env), io.Discard)
			if !errors.Is(err, ErrInvalid) {
				t.Errorf("got %v, want ErrInvalid", err)
			}
		})
	}
}

func TestLoadHelp(t *testing.T) {
	_, err := Load([]string{"-h"}, env(nil), io.Discard)
	if !errors.Is(err, flag.ErrHelp) {
		t.Errorf("got %v, want flag.ErrHelp", err)
	}
}

func TestIsLoopback(t *testing.T) {
	for host, want := range map[string]bool{
		"localhost": true, "127.0.0.1": true, "127.1.2.3": true, "::1": true,
		"0.0.0.0": false, "::": false, "10.0.0.1": false, "example.com": false, "": false,
	} {
		if got := IsLoopback(host); got != want {
			t.Errorf("IsLoopback(%q) = %v, want %v", host, got, want)
		}
	}
}
