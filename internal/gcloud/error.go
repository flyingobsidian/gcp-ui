package gcloud

// Cause classifies why a gcloud invocation did not succeed.
type Cause string

// Causes reported in Error.Cause.
const (
	CauseInvalidRequest Cause = "invalid_request"
	CauseExitStatus     Cause = "exit_status"
	CauseTimeout        Cause = "timeout"
	CauseCancelled      Cause = "cancelled"
	CauseOutputTooLarge Cause = "output_too_large"
	CauseStartFailed    Cause = "start_failed"
)

// Error is returned by Runner.Run for every failure. Result carries whatever
// was captured before the failure (stderr is usually the useful part).
type Error struct {
	Cause   Cause
	Message string
	Result  Result
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return string(e.Cause) + ": " + e.Message + ": " + e.Err.Error()
	}
	return string(e.Cause) + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }
