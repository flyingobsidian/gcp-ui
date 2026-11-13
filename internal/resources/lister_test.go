package resources

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/flyingobsidian/gcp-ui/internal/gcloud"
)

type fakeRunner struct {
	stdout string
	err    error
	got    []gcloud.Request
}

func (f *fakeRunner) Run(_ context.Context, req gcloud.Request) (gcloud.Result, error) {
	f.got = append(f.got, req)
	return gcloud.Result{Stdout: []byte(f.stdout)}, f.err
}

func TestParseIDs(t *testing.T) {
	valid := []string{"1", "123456789012", "9223372036854775807"}
	invalid := []string{
		"", "0", "0123", "-1", "12a", "1 2", "１２３", // full-width digits
		"organizations/123", "folders/123", "--flags-file=x", "123\n",
		"12345678901234567890", strings.Repeat("9", 100),
	}
	for _, s := range valid {
		if _, err := ParseOrganizationID(s); err != nil {
			t.Errorf("ParseOrganizationID(%q): %v", s, err)
		}
		if _, err := ParseFolderID(s); err != nil {
			t.Errorf("ParseFolderID(%q): %v", s, err)
		}
	}
	for _, s := range invalid {
		if _, err := ParseOrganizationID(s); !errors.Is(err, ErrInvalidID) {
			t.Errorf("ParseOrganizationID(%q) = %v, want ErrInvalidID", s, err)
		}
		if _, err := ParseFolderID(s); !errors.Is(err, ErrInvalidID) {
			t.Errorf("ParseFolderID(%q) = %v, want ErrInvalidID", s, err)
		}
	}
}

func TestListerCommands(t *testing.T) {
	org, err := ParseOrganizationID("111")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := ParseFolderID("222")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		call func(*Lister) (gcloud.Result, error)
		want []string
	}{
		{"organizations", func(l *Lister) (gcloud.Result, error) { return l.Organizations(context.Background()) },
			[]string{"organizations", "list"}},
		{"all projects", func(l *Lister) (gcloud.Result, error) { return l.AllProjects(context.Background()) },
			[]string{"projects", "list"}},
		{"folders in org", func(l *Lister) (gcloud.Result, error) { return l.FoldersInOrganization(context.Background(), org) },
			[]string{"resource-manager", "folders", "list", "--organization=111"}},
		{"projects in org", func(l *Lister) (gcloud.Result, error) { return l.ProjectsInOrganization(context.Background(), org) },
			[]string{"projects", "list", "--organization=111"}},
		{"folders in folder", func(l *Lister) (gcloud.Result, error) { return l.FoldersInFolder(context.Background(), folder) },
			[]string{"resource-manager", "folders", "list", "--folder=222"}},
		{"projects in folder", func(l *Lister) (gcloud.Result, error) { return l.ProjectsInFolder(context.Background(), folder) },
			[]string{"projects", "list", "--folder=222"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runner := &fakeRunner{stdout: `[{"name":"x"}]`}
			res, err := tt.call(NewLister(runner))
			if err != nil {
				t.Fatalf("unexpected error %v", err)
			}
			if len(runner.got) != 1 || !slices.Equal(runner.got[0].Args, tt.want) || runner.got[0].Project != "" {
				t.Errorf("ran %+v, want args %q", runner.got, tt.want)
			}
			if string(res.Stdout) != `[{"name":"x"}]` {
				t.Errorf("stdout = %q", res.Stdout)
			}
		})
	}
}

func TestListerRejectsZeroIDs(t *testing.T) {
	runner := &fakeRunner{}
	l := NewLister(runner)
	ctx := context.Background()
	for name, call := range map[string]func() (gcloud.Result, error){
		"org folders":     func() (gcloud.Result, error) { return l.FoldersInOrganization(ctx, OrganizationID{}) },
		"org projects":    func() (gcloud.Result, error) { return l.ProjectsInOrganization(ctx, OrganizationID{}) },
		"folder folders":  func() (gcloud.Result, error) { return l.FoldersInFolder(ctx, FolderID{}) },
		"folder projects": func() (gcloud.Result, error) { return l.ProjectsInFolder(ctx, FolderID{}) },
	} {
		if _, err := call(); !errors.Is(err, ErrInvalidID) {
			t.Errorf("%s: got %v, want ErrInvalidID", name, err)
		}
	}
	if len(runner.got) != 0 {
		t.Errorf("gcloud was invoked for an invalid id: %+v", runner.got)
	}
}

func TestListerNormalisesEmpty(t *testing.T) {
	for _, stdout := range []string{"null", "null\n", "", "  \n"} {
		res, err := NewLister(&fakeRunner{stdout: stdout}).Organizations(context.Background())
		if err != nil || string(res.Stdout) != "[]" {
			t.Errorf("stdout %q -> %q, %v; want []", stdout, res.Stdout, err)
		}
	}
}

func TestListerPassesThroughErrors(t *testing.T) {
	want := &gcloud.Error{Cause: gcloud.CauseExitStatus}
	_, err := NewLister(&fakeRunner{err: want}).Organizations(context.Background())
	if !errors.Is(err, want) {
		t.Errorf("got %v, want %v", err, want)
	}
}
