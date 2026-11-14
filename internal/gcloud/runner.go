// Package gcloud executes gcloud commands with JSON output. Commands run
// inside the gcp-ui process through gcloud-go's library (see Library), from
// an argv slice (never through a shell), with a timeout and a cap on the
// number of commands running at once.
package gcloud

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

const (
	defaultMaxStdout = 32 << 20
	maxStderr        = 1 << 20
	// defaultAbandonDelay is how long Run waits for a command to return after
	// cancelling its context, before giving up on it.
	defaultAbandonDelay = 5 * time.Second
)

// Result is the captured output of a gcloud invocation. ExitCode is the
// status the gcloud-go CLI would have exited with, or -1 when the command
// was abandoned before it finished.
type Result struct {
	Stdout   []byte
	Stderr   string
	ExitCode int
	Duration time.Duration
}

// Executor runs one command to completion, writing its output to stdout and
// stderr, and returns its exit status. It should return soon after ctx is
// done. Library.Execute is the production Executor.
type Executor func(ctx context.Context, args []string, stdout, stderr io.Writer) (exitCode int)

// Runner executes gcloud commands. It is safe for concurrent use.
type Runner struct {
	exec         Executor
	timeout      time.Duration
	sem          chan struct{}
	maxStdout    int
	abandonDelay time.Duration
}

// NewRunner returns a Runner that runs commands with exec, cancelling each
// after timeout and running at most maxConcurrent at once.
func NewRunner(exec Executor, timeout time.Duration, maxConcurrent int) *Runner {
	return &Runner{
		exec:         exec,
		timeout:      timeout,
		sem:          make(chan struct{}, maxConcurrent),
		maxStdout:    defaultMaxStdout,
		abandonDelay: defaultAbandonDelay,
	}
}

// Run validates req, waits for a free slot and runs the command. A nil error
// means it exited 0; otherwise the error is an *Error.
//
// A goroutine cannot be killed, so when a command overruns, Run cancels its
// context and waits up to abandonDelay for it to return. If it still has
// not, Run returns without it, but the command keeps its slot until it does
// return: a command that ignores cancellation can't let more than
// maxConcurrent pile up.
func (r *Runner) Run(ctx context.Context, req Request) (Result, error) {
	if err := req.validate(); err != nil {
		return Result{}, err
	}

	select {
	case r.sem <- struct{}{}:
	case <-ctx.Done():
		return Result{}, &Error{Cause: CauseCancelled, Message: "cancelled while waiting for a free slot", Err: ctx.Err()}
	}

	runCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()

	stdout := &cappedBuffer{limit: r.maxStdout, onOverflow: cancel}
	stderr := &cappedBuffer{limit: maxStderr}
	argv := req.argv()
	done := make(chan int, 1)
	start := time.Now()
	go func() {
		defer func() { <-r.sem }()
		done <- r.exec(runCtx, argv, stdout, stderr)
	}()

	exitCode, finished := -1, true
	select {
	case exitCode = <-done:
	case <-runCtx.Done():
		select {
		case exitCode = <-done:
		case <-time.After(r.abandonDelay):
			finished = false
		}
	}
	res := Result{
		Stdout:   stdout.Bytes(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
		Duration: time.Since(start),
	}

	switch {
	case stdout.Overflowed():
		return res, &Error{Cause: CauseOutputTooLarge, Message: fmt.Sprintf("stdout exceeded %d bytes", r.maxStdout), Result: res}
	case finished && exitCode == 0:
		return res, nil
	case errors.Is(runCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil:
		return res, &Error{Cause: CauseTimeout, Message: fmt.Sprintf("gcloud did not finish within %s", r.timeout), Result: res}
	case ctx.Err() != nil:
		return res, &Error{Cause: CauseCancelled, Message: "request cancelled", Result: res, Err: ctx.Err()}
	default:
		return res, &Error{Cause: CauseExitStatus, Message: fmt.Sprintf("gcloud exited with status %d", res.ExitCode), Result: res}
	}
}

// cappedBuffer keeps at most limit bytes. Writes never fail, so a command
// is not tripped up by a write error; onOverflow (if set) is called once
// when the limit is hit. It is safe for concurrent use, because a command
// may write from several goroutines, and may still be writing after Run
// has abandoned it and read the buffer.
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
