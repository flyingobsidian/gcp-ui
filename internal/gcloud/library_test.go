package gcloud

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"testing"

	gcloudgo "github.com/flyingobsidian/gcloud-go/gcloud"
)

// testLibrary returns a Library whose commands use a fresh, empty gcloud
// configuration directory and no other environment, so tests never touch the
// real gcloud configuration or credentials.
func testLibrary(t *testing.T) *Library {
	t.Helper()
	dir := t.TempDir()
	getenv := func(key string) string {
		if key == "CLOUDSDK_CONFIG" {
			return dir
		}
		return ""
	}
	home := func() (string, error) { return dir, nil }
	return newLibrary(gcloudgo.Options{Getenv: getenv, HomeDir: home}, slog.New(slog.DiscardHandler))
}

func execute(l *Library, args ...string) (stdout, stderr string, code int) {
	var out, errOut strings.Builder
	code = l.Execute(context.Background(), args, &out, &errOut)
	return out.String(), errOut.String(), code
}

func TestLibraryRunsGcloudGo(t *testing.T) {
	l := testLibrary(t)
	stdout, stderr, code := execute(l, "--version")
	if code != 0 || !strings.Contains(stdout, "gcloud-go") {
		t.Errorf("code %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}

func TestLibraryReportsErrorsLikeTheCLI(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"unknown command", []string{"no-such-command-group"}, `ERROR: (gcloud) unknown command "no-such-command-group" for "gcloud"` + "\n"},
		{"unknown flag", []string{"projects", "list", "--no-such-flag"}, "ERROR: (gcloud.projects.list) unknown flag: --no-such-flag\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := testLibrary(t)
			_, stderr, code := execute(l, tt.args...)
			if code != 1 || !strings.HasPrefix(stderr, strings.TrimSuffix(tt.want, "\n")) || !strings.HasSuffix(stderr, "\n") {
				t.Errorf("code %d, stderr %q; want 1 and %q", code, stderr, tt.want)
			}
		})
	}
}

// Each Library uses its own configuration even when commands from several
// run at once.
func TestLibraryConcurrentConfigs(t *testing.T) {
	const n = 8
	libs := make([]*Library, n)
	for i := range libs {
		libs[i] = testLibrary(t)
		if _, stderr, code := execute(libs[i], "config", "set", "core/project", fmt.Sprintf("project-%d", i)); code != 0 {
			t.Fatalf("config set: code %d, stderr %q", code, stderr)
		}
	}
	var wg sync.WaitGroup
	for i, l := range libs {
		for range 4 {
			wg.Go(func() {
				stdout, stderr, code := execute(l, "config", "get", "core/project")
				if want := fmt.Sprintf("project-%d\n", i); code != 0 || stdout != want {
					t.Errorf("library %d: code %d, stdout %q, stderr %q; want %q", i, code, stdout, stderr, want)
				}
			})
		}
	}
	wg.Wait()
}

func TestLibraryRenewsRunnerAfterAuth(t *testing.T) {
	l := testLibrary(t)
	before := l.runner.Load()
	if _, stderr, code := execute(l, "config", "get", "core/project"); code != 0 {
		t.Fatalf("config get: code %d, stderr %q", code, stderr)
	}
	if l.runner.Load() != before {
		t.Error("runner replaced after a non-auth command")
	}
	if _, stderr, code := execute(l, "auth", "list"); code != 0 {
		t.Fatalf("auth list: code %d, stderr %q", code, stderr)
	}
	if l.runner.Load() == before {
		t.Error("runner not replaced after an auth command")
	}
}

func TestNoPromptsGetenv(t *testing.T) {
	getenv := noPromptsGetenv(func(key string) string { return "from-" + key })
	if got := getenv("CLOUDSDK_CORE_DISABLE_PROMPTS"); got != "1" {
		t.Errorf("CLOUDSDK_CORE_DISABLE_PROMPTS = %q, want 1", got)
	}
	if got := getenv("HOME"); got != "from-HOME" {
		t.Errorf("HOME = %q, want from-HOME", got)
	}
}

func TestErrorText(t *testing.T) {
	exitErr := exitError(t)
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"success", nil, ""},
		{"subprocess exit", fmt.Errorf("ssh: %w", exitErr), ""},
		{"panic", &gcloudgo.PanicError{Value: "boom", Stack: []byte("stack")}, "panic: boom\n\nstack"},
		{"other", errors.New("bad arguments"), "bad arguments\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := errorText([]string{"x"}, tt.err); got != tt.want {
				t.Errorf("errorText = %q, want %q", got, tt.want)
			}
		})
	}
}

// exitError returns a real *exec.ExitError.
func exitError(t *testing.T) error {
	t.Helper()
	err := exec.Command("sh", "-c", "exit 5").Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("got %v, want *exec.ExitError", err)
	}
	return err
}
