package gcloud

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync/atomic"

	gcloudgo "github.com/flyingobsidian/gcloud-go/gcloud"
)

// Library runs commands with gcloud-go, which is linked into gcp-ui. It is
// safe for concurrent use.
//
// All commands share one gcloud-go Runner, so an access token is fetched
// once and reused. That Runner caches credentials, so after a successful
// `auth` command (which may have replaced them) Library starts a new one;
// commands already running finish on the old one.
type Library struct {
	opts   gcloudgo.Options
	logger *slog.Logger
	runner atomic.Pointer[gcloudgo.Runner]
}

// NewLibrary returns a Library whose commands see the process environment,
// plus CLOUDSDK_CORE_DISABLE_PROMPTS=1 for any subprocess they start.
// Commands that panic are logged to logger.
func NewLibrary(logger *slog.Logger) *Library {
	return newLibrary(gcloudgo.Options{Getenv: noPromptsGetenv(os.Getenv)}, logger)
}

func newLibrary(opts gcloudgo.Options, logger *slog.Logger) *Library {
	l := &Library{opts: opts, logger: logger}
	l.runner.Store(gcloudgo.NewRunner(opts))
	return l
}

// noPromptsGetenv wraps getenv so that CLOUDSDK_CORE_DISABLE_PROMPTS is 1.
// gcloud-go never prompts in-process; this keeps any real gcloud it starts
// from prompting either.
func noPromptsGetenv(getenv func(string) string) func(string) string {
	return func(key string) string {
		if key == "CLOUDSDK_CORE_DISABLE_PROMPTS" {
			return "1"
		}
		return getenv(key)
	}
}

// Execute is an Executor. Errors are written to stderr as the gcloud-go CLI
// would print them, and turned into the CLI's exit status.
func (l *Library) Execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	err := l.runner.Load().Run(ctx, gcloudgo.Invocation{Args: args, Stdout: stdout, Stderr: stderr})
	if err == nil && len(args) > 0 && args[0] == "auth" {
		l.runner.Store(gcloudgo.NewRunner(l.opts))
	}
	var panicErr *gcloudgo.PanicError
	if errors.As(err, &panicErr) {
		l.logger.Error("gcloud-go command panicked", "args", args, "panic", panicErr.Value, "stack", string(panicErr.Stack))
	}
	if msg := errorText(args, err); msg != "" {
		// stderr is a capped buffer whose writes never fail.
		_, _ = io.WriteString(stderr, msg)
	}
	return gcloudgo.ExitCode(err)
}

// errorText is what the gcloud-go CLI prints for err, or "" when it prints
// nothing more than the command already has.
func errorText(args []string, err error) string {
	var (
		exitErr  *exec.ExitError
		panicErr *gcloudgo.PanicError
	)
	switch {
	case err == nil:
		return ""
	case errors.As(err, &panicErr):
		return fmt.Sprintf("panic: %v\n\n%s", panicErr.Value, panicErr.Stack)
	case errors.As(err, &exitErr):
		// A subprocess such as ssh failed; its own output says why.
		return ""
	case errors.Is(err, gcloudgo.ErrNotInProcess) && len(args) > 0:
		// gcp-ui has no other gcloud to fall back on; this is the CLI's
		// message for a command it doesn't have.
		return fmt.Sprintf("ERROR: (gcloud) unknown command %q for \"gcloud\"\n", args[0])
	default:
		// *CommandError's text is the CLI's message; argument errors are
		// printed as they are.
		return err.Error() + "\n"
	}
}
