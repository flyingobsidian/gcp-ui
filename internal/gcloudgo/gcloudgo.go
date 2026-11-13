// Package gcloudgo runs gcloud-go, which is linked into the gcp-ui binary.
//
// gcloud-go keeps flag values in package globals and writes to os.Stdout, so
// it cannot run several commands concurrently in one process. Instead the
// server re-executes its own binary with ChildEnv set; main sees the variable
// and calls Main, which runs a single gcloud-go command and exits. Each
// command therefore keeps its own process: timeouts, cancellation and output
// capture work exactly as for an external gcloud binary.
package gcloudgo

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime/debug"

	gcloudcmd "github.com/flyingobsidian/gcloud-go/cmd"
)

const (
	childEnv   = "GCPUI_RUN_GCLOUD_GO"
	modulePath = "github.com/flyingobsidian/gcloud-go"
	selfExe    = "/proc/self/exe"
)

// ChildEnv returns the environment entries that switch a re-executed gcp-ui
// binary into gcloud-go mode.
func ChildEnv() []string {
	return []string{childEnv + "=1"}
}

// IsChild reports whether this process was started to run a gcloud-go command.
func IsChild() bool {
	return os.Getenv(childEnv) == "1"
}

// Main runs gcloud-go with os.Args[1:] and returns the process exit code.
//
// Unlike gcloud-go's own main, it never offers to enable a disabled API and
// retry: gcp-ui must not change project settings as a side effect.
func Main() int {
	// gcloud-go may start subprocesses of its own; they must not inherit
	// gcloud-go mode.
	if err := os.Unsetenv(childEnv); err != nil {
		fmt.Fprintln(os.Stderr, "gcp-ui: clear", childEnv+":", err)
		return 1
	}
	executed, err := gcloudcmd.Execute()
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	fmt.Fprintln(os.Stderr, gcloudcmd.FormatCLIError(executed, err))
	return 1
}

// Executable returns the path the server should execute to run gcloud-go.
// On Linux this is /proc/self/exe, which always refers to the running
// binary, so commands keep using the same build as the server even if
// bin/gcp-ui is rebuilt while it runs.
func Executable() (string, error) {
	if _, err := os.Stat(selfExe); err == nil {
		return selfExe, nil
	}
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate gcp-ui executable: %w", err)
	}
	return path, nil
}

// Version describes the linked gcloud-go: the version stamped at build time
// (see the Makefile), else the module version recorded by the Go toolchain.
func Version() string {
	if gcloudcmd.Version != "" && gcloudcmd.Version != "dev" {
		return gcloudcmd.Version
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, dep := range info.Deps {
		if dep.Path != modulePath {
			continue
		}
		if dep.Replace != nil {
			return "local " + dep.Replace.Path
		}
		return dep.Version
	}
	return "unknown"
}
