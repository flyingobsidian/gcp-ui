package gcloudgo

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestMain doubles as the gcloud-go child: when re-executed with ChildEnv set,
// the test binary runs Main instead of the tests, just as gcp-ui's main does.
func TestMain(m *testing.M) {
	if IsChild() {
		os.Exit(Main())
	}
	os.Exit(m.Run())
}

func runChild(t *testing.T, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, args...)
	cmd.Env = append(os.Environ(), ChildEnv()...)
	var out, errOut strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err = cmd.Run()
	code = 0
	if exitErr, ok := err.(*exec.ExitError); ok {
		code = exitErr.ExitCode()
	} else if err != nil {
		t.Fatalf("run child: %v", err)
	}
	return out.String(), errOut.String(), code
}

func TestChildRunsGcloudGo(t *testing.T) {
	stdout, stderr, code := runChild(t, "--version")
	if code != 0 || !strings.Contains(stdout, "gcloud-go") {
		t.Errorf("code %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}

func TestChildReportsErrors(t *testing.T) {
	_, stderr, code := runChild(t, "no-such-command-group")
	if code == 0 || stderr == "" {
		t.Errorf("code %d, stderr %q; want a non-zero exit and a message", code, stderr)
	}
}

func TestIsChild(t *testing.T) {
	if IsChild() {
		t.Fatal("test process should not be in child mode")
	}
	t.Setenv(childEnv, "1")
	if !IsChild() {
		t.Error("IsChild = false with ChildEnv set")
	}
}

func TestExecutable(t *testing.T) {
	path, err := Executable()
	if err != nil || path == "" {
		t.Fatalf("Executable = %q, %v", path, err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("stat %s: %v", path, err)
	}
}

// Test binaries carry no dependency build info, so Version may report
// "unknown" here; the real binary is checked by the Makefile's version stamp.
func TestVersion(t *testing.T) {
	if v := Version(); v == "" {
		t.Error("Version is empty")
	}
}
