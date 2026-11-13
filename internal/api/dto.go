package api

import "encoding/json"

type runRequest struct {
	Args    []string `json:"args"`
	Project string   `json:"project,omitempty"`
}

// runResponse carries gcloud's stdout as JSON in Output, or as text in
// OutputText when it is not valid JSON. Both are empty when stdout was empty.
type runResponse struct {
	Output     json.RawMessage `json:"output,omitempty"`
	OutputText string          `json:"outputText,omitempty"`
	Stderr     string          `json:"stderr"`
	ExitCode   int             `json:"exitCode"`
	DurationMs int64           `json:"durationMs"`
}

type healthResponse struct {
	Status string `json:"status"`
}

type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Cause      string `json:"cause"`
	Message    string `json:"message"`
	Stderr     string `json:"stderr,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
}
