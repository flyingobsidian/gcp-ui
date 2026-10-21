package gcloud

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// fakeGcloud writes a shell script standing in for gcloud. Its behaviour is
// selected by the first argument so each test controls the outcome.
func fakeGcloud(t *testing.T) string {
	t.Helper()
	script := `#!/bin/sh
case "$1" in
  echo)    printf '%s\n' "$@" ;;
  json)    printf '[{"name":"vm-1"}]' ;;
  fail)    echo "ERROR: permission denied" >&2; exit 3 ;;
  sleep)   exec sleep 10 ;;
  flood)   while :; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done ;;
  prompts) printf '%s' "$CLOUDSDK_CORE_DISABLE_PROMPTS" ;;
  env)     printf '%s' "$GCPUI_TEST_EXTRA" ;;
esac
`
	path := filepath.Join(t.TempDir(), "gcloud")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake gcloud: %v", err)
	}
	return path
}

func TestRunSuccess(t *testing.T) {
	r := NewRunner(fakeGcloud(t), nil, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"json"}})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if string(res.Stdout) != `[{"name":"vm-1"}]` || res.ExitCode != 0 {
		t.Errorf("unexpected result %+v", res)
	}
}

func TestRunInjectsFlags(t *testing.T) {
	r := NewRunner(fakeGcloud(t), nil, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"echo", "list", "--", "x"}, Project: "my-project-1"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	got := strings.Split(strings.TrimSpace(string(res.Stdout)), "\n")
	want := []string{"echo", "list", "--format=json", "--project=my-project-1", "--", "x"}
	if !slices.Equal(got, want) {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

func TestRunDisablesPrompts(t *testing.T) {
	r := NewRunner(fakeGcloud(t), nil, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"prompts"}})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if string(res.Stdout) != "1" {
		t.Errorf("CLOUDSDK_CORE_DISABLE_PROMPTS = %q, want 1", res.Stdout)
	}
}

func TestRunAddsExtraEnv(t *testing.T) {
	r := NewRunner(fakeGcloud(t), []string{"GCPUI_TEST_EXTRA=yes"}, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"env"}})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if string(res.Stdout) != "yes" {
		t.Errorf("GCPUI_TEST_EXTRA = %q, want yes", res.Stdout)
	}
}

func TestRunFailures(t *testing.T) {
	gcloud := fakeGcloud(t)
	tests := []struct {
		name    string
		args    []string
		timeout time.Duration
		cause   Cause
	}{
		{"exit status", []string{"fail"}, 5 * time.Second, CauseExitStatus},
		{"timeout", []string{"sleep"}, 100 * time.Millisecond, CauseTimeout},
		{"output too large", []string{"flood"}, 5 * time.Second, CauseOutputTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRunner(gcloud, nil, tt.timeout, 1)
			r.maxStdout = 4096
			_, err := r.Run(context.Background(), Request{Args: tt.args})
			var gerr *Error
			if !errors.As(err, &gerr) {
				t.Fatalf("got %v, want *Error", err)
			}
			if gerr.Cause != tt.cause {
				t.Errorf("cause = %s, want %s (%v)", gerr.Cause, tt.cause, err)
			}
		})
	}
}

func TestRunExitStatusKeepsStderr(t *testing.T) {
	r := NewRunner(fakeGcloud(t), nil, 5*time.Second, 1)
	_, err := r.Run(context.Background(), Request{Args: []string{"fail"}})
	var gerr *Error
	if !errors.As(err, &gerr) {
		t.Fatalf("got %v, want *Error", err)
	}
	if gerr.Result.ExitCode != 3 || !strings.Contains(gerr.Result.Stderr, "permission denied") {
		t.Errorf("unexpected result %+v", gerr.Result)
	}
}

func TestRunStartFailed(t *testing.T) {
	r := NewRunner(filepath.Join(t.TempDir(), "missing"), nil, time.Second, 1)
	_, err := r.Run(context.Background(), Request{Args: []string{"x"}})
	var gerr *Error
	if !errors.As(err, &gerr) || gerr.Cause != CauseStartFailed {
		t.Errorf("got %v, want start_failed", err)
	}
}

func TestRunCancelledWhileQueued(t *testing.T) {
	r := NewRunner(fakeGcloud(t), nil, 5*time.Second, 1)
	r.sem <- struct{}{} // occupy the only slot
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := r.Run(ctx, Request{Args: []string{"json"}})
	var gerr *Error
	if !errors.As(err, &gerr) || gerr.Cause != CauseCancelled {
		t.Errorf("got %v, want cancelled", err)
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name string
		req  Request
		ok   bool
	}{
		{"ok", Request{Args: []string{"compute", "instances", "list"}, Project: "my-project"}, true},
		{"domain scoped project", Request{Args: []string{"projects", "list"}, Project: "example.com:my-project"}, true},
		{"empty", Request{}, false},
		{"format flag", Request{Args: []string{"projects", "list", "--format=yaml"}}, false},
		{"format flag separate", Request{Args: []string{"projects", "list", "--format", "yaml"}}, false},
		{"project flag", Request{Args: []string{"projects", "list", "--project=x"}}, false},
		{"format after separator", Request{Args: []string{"compute", "ssh", "vm", "--", "--format=x"}}, true},
		{"bad project", Request{Args: []string{"projects", "list"}, Project: "Bad_Project"}, false},
		{"nul byte", Request{Args: []string{"a\x00b"}}, false},
		{"too many args", Request{Args: make([]string, maxArgs+1)}, false},
		{"long arg", Request{Args: []string{strings.Repeat("a", maxArgLen+1)}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.validate()
			if tt.ok && err != nil {
				t.Errorf("unexpected error %v", err)
			}
			if !tt.ok {
				var gerr *Error
				if !errors.As(err, &gerr) || gerr.Cause != CauseInvalidRequest {
					t.Errorf("got %v, want invalid_request", err)
				}
			}
		})
	}
}
