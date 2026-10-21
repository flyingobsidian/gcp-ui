package gcloud

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	maxArgs   = 64
	maxArgLen = 4096
)

// reservedFlags are injected by the runner and may not be supplied by callers.
var reservedFlags = []string{"--format", "--project"}

// projectIDPattern accepts standard project IDs and legacy domain-scoped ones
// such as "example.com:my-project".
var projectIDPattern = regexp.MustCompile(`^([a-z][a-z0-9.-]*[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$`)

// Request is a single gcloud invocation. Args excludes the binary name and must
// not set --format or --project; Project, when non-empty, becomes --project.
type Request struct {
	Args    []string
	Project string
}

func (r Request) validate() error {
	if len(r.Args) == 0 {
		return invalid("args must not be empty")
	}
	if len(r.Args) > maxArgs {
		return invalid(fmt.Sprintf("too many args (%d > %d)", len(r.Args), maxArgs))
	}
	for i, a := range r.Args {
		if len(a) > maxArgLen {
			return invalid(fmt.Sprintf("arg %d exceeds %d bytes", i, maxArgLen))
		}
		if strings.ContainsRune(a, 0) {
			return invalid(fmt.Sprintf("arg %d contains a NUL byte", i))
		}
		if a == "--" {
			// Everything after "--" is positional, so it cannot set reserved flags.
			break
		}
		for _, f := range reservedFlags {
			if a == f || strings.HasPrefix(a, f+"=") {
				return invalid(fmt.Sprintf("%s is set by gcp-ui and must not be passed in args", f))
			}
		}
	}
	if r.Project != "" && !projectIDPattern.MatchString(r.Project) {
		return invalid(fmt.Sprintf("invalid project id %q", r.Project))
	}
	return nil
}

// argv returns the arguments passed to the gcloud binary. Injected flags are
// placed before any "--" separator so they are parsed as flags.
func (r Request) argv() []string {
	injected := []string{"--format=json"}
	if r.Project != "" {
		injected = append(injected, "--project="+r.Project)
	}
	split := len(r.Args)
	for i, a := range r.Args {
		if a == "--" {
			split = i
			break
		}
	}
	out := make([]string, 0, len(r.Args)+len(injected))
	out = append(out, r.Args[:split]...)
	out = append(out, injected...)
	return append(out, r.Args[split:]...)
}

func invalid(msg string) *Error {
	return &Error{Cause: CauseInvalidRequest, Message: msg}
}
