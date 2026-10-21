// Package resources lists GCP resource-hierarchy objects (organizations,
// folders, projects) through gcloud. Every caller-supplied identifier is
// parsed into a validated type before any gcloud invocation is built.
package resources

import (
	"errors"
	"fmt"
	"regexp"
)

// ErrInvalidID is wrapped by every identifier validation failure.
var ErrInvalidID = errors.New("invalid resource id")

// Organization and folder IDs are positive decimal integers; the API uses
// int64-sized values, so 19 digits is the upper bound.
var numericIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

// OrganizationID is a validated numeric organization ID, e.g. "123456789012".
type OrganizationID struct{ id string }

// FolderID is a validated numeric folder ID, e.g. "987654321098".
type FolderID struct{ id string }

// ParseOrganizationID validates s as a bare numeric organization ID.
func ParseOrganizationID(s string) (OrganizationID, error) {
	if !numericIDPattern.MatchString(s) {
		return OrganizationID{}, fmt.Errorf("%w: organization id %q must be a positive integer of at most 19 digits", ErrInvalidID, truncate(s))
	}
	return OrganizationID{id: s}, nil
}

// ParseFolderID validates s as a bare numeric folder ID.
func ParseFolderID(s string) (FolderID, error) {
	if !numericIDPattern.MatchString(s) {
		return FolderID{}, fmt.Errorf("%w: folder id %q must be a positive integer of at most 19 digits", ErrInvalidID, truncate(s))
	}
	return FolderID{id: s}, nil
}

func (o OrganizationID) String() string { return o.id }
func (f FolderID) String() string       { return f.id }

// truncate keeps error messages bounded when echoing hostile input.
func truncate(s string) string {
	const maxEcho = 40
	if len(s) > maxEcho {
		return s[:maxEcho] + "…"
	}
	return s
}
