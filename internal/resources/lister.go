package resources

import (
	"bytes"
	"context"
	"fmt"

	"github.com/flyingobsidian/gcp-ui/internal/gcloud"
)

// Runner executes a gcloud request.
type Runner interface {
	Run(ctx context.Context, req gcloud.Request) (gcloud.Result, error)
}

// Lister builds and runs the gcloud list commands for the resource hierarchy.
type Lister struct {
	runner Runner
}

// NewLister returns a Lister backed by runner.
func NewLister(runner Runner) *Lister {
	return &Lister{runner: runner}
}

// Organizations runs `gcloud organizations list`.
func (l *Lister) Organizations(ctx context.Context) (gcloud.Result, error) {
	return l.list(ctx, "organizations", "list")
}

// AllProjects runs `gcloud projects list`: every active project the account can
// see, wherever it sits in the hierarchy.
func (l *Lister) AllProjects(ctx context.Context) (gcloud.Result, error) {
	return l.list(ctx, "projects", "list")
}

// FoldersInOrganization runs `gcloud resource-manager folders list --organization=ID`.
func (l *Lister) FoldersInOrganization(ctx context.Context, org OrganizationID) (gcloud.Result, error) {
	if org.id == "" {
		return gcloud.Result{}, fmt.Errorf("%w: organization id is empty", ErrInvalidID)
	}
	return l.list(ctx, "resource-manager", "folders", "list", "--organization="+org.id)
}

// FoldersInFolder runs `gcloud resource-manager folders list --folder=ID`.
func (l *Lister) FoldersInFolder(ctx context.Context, parent FolderID) (gcloud.Result, error) {
	if parent.id == "" {
		return gcloud.Result{}, fmt.Errorf("%w: folder id is empty", ErrInvalidID)
	}
	return l.list(ctx, "resource-manager", "folders", "list", "--folder="+parent.id)
}

// ProjectsInOrganization runs `gcloud projects list --organization=ID`, which
// returns only projects whose direct parent is the organization (not those
// nested in its folders).
func (l *Lister) ProjectsInOrganization(ctx context.Context, org OrganizationID) (gcloud.Result, error) {
	if org.id == "" {
		return gcloud.Result{}, fmt.Errorf("%w: organization id is empty", ErrInvalidID)
	}
	return l.list(ctx, "projects", "list", "--organization="+org.id)
}

// ProjectsInFolder runs `gcloud projects list --folder=ID`.
func (l *Lister) ProjectsInFolder(ctx context.Context, parent FolderID) (gcloud.Result, error) {
	if parent.id == "" {
		return gcloud.Result{}, fmt.Errorf("%w: folder id is empty", ErrInvalidID)
	}
	return l.list(ctx, "projects", "list", "--folder="+parent.id)
}

// list runs a list command. An empty result is normalised to "[]": some
// gcloud builds print "null" (or nothing) when there are no items.
func (l *Lister) list(ctx context.Context, args ...string) (gcloud.Result, error) {
	res, err := l.runner.Run(ctx, gcloud.Request{Args: args})
	if err != nil {
		return res, err
	}
	if trimmed := bytes.TrimSpace(res.Stdout); len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		res.Stdout = []byte("[]")
	}
	return res, nil
}
