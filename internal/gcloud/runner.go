// Package gcloud executes gcloud commands with JSON output. Commands are run
// directly from an argv slice (never through a shell), with a timeout and a
// cap on the number of concurrent processes.
package gcloud

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"
)

const (
	defaultMaxStdout = 32 << 20
	maxStderr        = 1 << 20
	waitDelay        = 5 * time.Second
)

// Result is the captured output of a gcloud invocation.
type Result struct {
	Stdout   []byte
	Stderr   string
	ExitCode int
	Duration time.Duration
}

// Runner executes gcloud. It is safe for concurrent use.
type Runner struct {
	path      string
	timeout   time.Duration
	sem       chan struct{}
	maxStdout int
}

// NewRunner returns a Runner that executes the binary at path, killing each
// command after timeout and running at most maxConcurrent at once.
func NewRunner(path string, timeout time.Duration, maxConcurrent int) *Runner {
	return &Runner{
		path:      path,
		timeout:   timeout,
		sem:       make(chan struct{}, maxConcurrent),
		maxStdout: defaultMaxStdout,
	}
}

// Run validates req, waits for a free slot and executes gcloud. A nil error
// means gcloud exited 0; otherwise the error is an *Error.
func (r *Runner) Run(ctx context.Context, req Request) (Result, error) {
	if err := req.validate(); err != nil {
		return Result{}, err
	}

	select {
	case r.sem <- struct{}{}:
	case <-ctx.Done():
		return Result{}, &Error{Cause: CauseCancelled, Message: "cancelled while waiting for a free slot", Err: ctx.Err()}
	}
	defer func() { <-r.sem }()

	runCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()

	stdout := &cappedBuffer{limit: r.maxStdout, onOverflow: cancel}
	stderr := &cappedBuffer{limit: maxStderr}
	cmd := exec.CommandContext(runCtx, r.path, req.argv()...)
	cmd.Env = append(os.Environ(), "CLOUDSDK_CORE_DISABLE_PROMPTS=1")
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.WaitDelay = waitDelay

	start := time.Now()
	runErr := cmd.Run()
	res := Result{
		Stdout:   stdout.Bytes(),
		Stderr:   stderr.String(),
		ExitCode: -1,
		Duration: time.Since(start),
	}
	if cmd.ProcessState != nil {
		res.ExitCode = cmd.ProcessState.ExitCode()
	}

	var exitErr *exec.ExitError
	switch {
	case runErr == nil:
		return res, nil
	case stdout.Overflowed():
		return res, &Error{Cause: CauseOutputTooLarge, Message: fmt.Sprintf("stdout exceeded %d bytes", r.maxStdout), Result: res}
	case errors.Is(runCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil:
		return res, &Error{Cause: CauseTimeout, Message: fmt.Sprintf("gcloud did not finish within %s", r.timeout), Result: res}
	case ctx.Err() != nil:
		return res, &Error{Cause: CauseCancelled, Message: "request cancelled", Result: res, Err: ctx.Err()}
	case errors.As(runErr, &exitErr):
		return res, &Error{Cause: CauseExitStatus, Message: fmt.Sprintf("gcloud exited with status %d", res.ExitCode), Result: res}
	default:
		return res, &Error{Cause: CauseStartFailed, Message: "could not run gcloud", Result: res, Err: runErr}
	}
}

// cappedBuffer keeps at most limit bytes. Writes never fail, so the child's
// pipe keeps draining; onOverflow (if set) is called once when the limit is hit.
type cappedBuffer struct {
	mu         sync.Mutex
	buf        bytes.Buffer
	limit      int
	overflowed bool
	onOverflow func()
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if room := b.limit - b.buf.Len(); room < len(p) {
		b.buf.Write(p[:max(room, 0)])
		if !b.overflowed {
			b.overflowed = true
			if b.onOverflow != nil {
				b.onOverflow()
			}
		}
		return len(p), nil
	}
	return b.buf.Write(p)
}

func (b *cappedBuffer) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return bytes.Clone(b.buf.Bytes())
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func (b *cappedBuffer) Overflowed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.overflowed
}
