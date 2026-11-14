package gcloud

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeExec stands in for gcloud-go. Its behaviour is selected by the first
// argument so each test controls the outcome.
func fakeExec(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	switch args[0] {
	case "echo":
		fmt.Fprint(stdout, strings.Join(args, "\n"))
	case "json":
		fmt.Fprint(stdout, `[{"name":"vm-1"}]`)
	case "fail":
		fmt.Fprintln(stderr, "ERROR: permission denied")
		return 3
	case "sleep":
		<-ctx.Done()
		return 1
	case "flood":
		for ctx.Err() == nil {
			fmt.Fprintln(stdout, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
		}
		return 1
	}
	return 0
}

func TestRunSuccess(t *testing.T) {
	r := NewRunner(fakeExec, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"json"}})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if string(res.Stdout) != `[{"name":"vm-1"}]` || res.ExitCode != 0 {
		t.Errorf("unexpected result %+v", res)
	}
}

func TestRunInjectsFlags(t *testing.T) {
	r := NewRunner(fakeExec, 5*time.Second, 2)
	res, err := r.Run(context.Background(), Request{Args: []string{"echo", "list", "--", "x"}, Project: "my-project-1"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	got := strings.Split(string(res.Stdout), "\n")
	want := []string{"echo", "list", "--format=json", "--project=my-project-1", "--", "x"}
	if !slices.Equal(got, want) {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

func TestRunFailures(t *testing.T) {
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
			r := NewRunner(fakeExec, tt.timeout, 1)
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
	r := NewRunner(fakeExec, 5*time.Second, 1)
	_, err := r.Run(context.Background(), Request{Args: []string{"fail"}})
	var gerr *Error
	if !errors.As(err, &gerr) {
		t.Fatalf("got %v, want *Error", err)
	}
	if gerr.Result.ExitCode != 3 || !strings.Contains(gerr.Result.Stderr, "permission denied") {
		t.Errorf("unexpected result %+v", gerr.Result)
	}
}

func TestRunCancelled(t *testing.T) {
	r := NewRunner(fakeExec, 5*time.Second, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := r.Run(ctx, Request{Args: []string{"sleep"}})
	var gerr *Error
	if !errors.As(err, &gerr) || gerr.Cause != CauseCancelled {
		t.Errorf("got %v, want cancelled", err)
	}
}

func TestRunCancelledWhileQueued(t *testing.T) {
	r := NewRunner(fakeExec, 5*time.Second, 1)
	r.sem <- struct{}{} // occupy the only slot
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := r.Run(ctx, Request{Args: []string{"json"}})
	var gerr *Error
	if !errors.As(err, &gerr) || gerr.Cause != CauseCancelled {
		t.Errorf("got %v, want cancelled", err)
	}
}

// A command that ignores cancellation is abandoned after abandonDelay, but
// keeps its slot until it really returns.
func TestRunAbandonsStuckCommand(t *testing.T) {
	release := make(chan struct{})
	returned := make(chan struct{})
	stuck := func(ctx context.Context, args []string, stdout, stderr io.Writer) int {
		if args[0] != "stuck" {
			return fakeExec(ctx, args, stdout, stderr)
		}
		defer close(returned)
		fmt.Fprint(stderr, "partial")
		<-release
		fmt.Fprint(stderr, " output written after Run returned")
		return 0
	}
	r := NewRunner(stuck, 50*time.Millisecond, 1)
	r.abandonDelay = 50 * time.Millisecond

	_, err := r.Run(context.Background(), Request{Args: []string{"stuck"}})
	var gerr *Error
	if !errors.As(err, &gerr) || gerr.Cause != CauseTimeout {
		t.Fatalf("got %v, want timeout", err)
	}
	if gerr.Result.ExitCode != -1 || gerr.Result.Stderr != "partial" {
		t.Errorf("unexpected result %+v", gerr.Result)
	}

	// The stuck command still holds the only slot.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := r.Run(ctx, Request{Args: []string{"json"}}); !errors.As(err, &gerr) || gerr.Cause != CauseCancelled {
		t.Errorf("second Run got %v, want cancelled while queued", err)
	}

	close(release)
	<-returned
	if _, err := r.Run(context.Background(), Request{Args: []string{"json"}}); err != nil {
		t.Errorf("Run after the stuck command returned: %v", err)
	}
}

func TestRunLimitsConcurrency(t *testing.T) {
	const limit, runs = 3, 20
	var running, peak atomic.Int32
	counting := func(ctx context.Context, args []string, stdout, stderr io.Writer) int {
		n := running.Add(1)
		defer running.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
		return fakeExec(ctx, args, stdout, stderr)
	}
	r := NewRunner(counting, 5*time.Second, limit)
	var wg sync.WaitGroup
	for i := range runs {
		wg.Go(func() {
			res, err := r.Run(context.Background(), Request{Args: []string{"echo", fmt.Sprint(i)}})
			if err != nil {
				t.Errorf("Run %d: %v", i, err)
				return
			}
			if want := fmt.Sprintf("echo\n%d\n--format=json", i); string(res.Stdout) != want {
				t.Errorf("Run %d stdout %q, want %q", i, res.Stdout, want)
			}
		})
	}
	wg.Wait()
	if p := peak.Load(); p > limit {
		t.Errorf("%d commands ran at once, limit %d", p, limit)
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
