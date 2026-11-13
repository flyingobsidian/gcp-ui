package session

import (
	"regexp"
	"testing"
)

var uuid4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewToken(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		tok, err := NewToken()
		if err != nil {
			t.Fatalf("NewToken: %v", err)
		}
		if !uuid4.MatchString(tok) {
			t.Fatalf("%q is not a version 4 UUID", tok)
		}
		if seen[tok] {
			t.Fatalf("duplicate token %q", tok)
		}
		seen[tok] = true
	}
}

func TestCookieName(t *testing.T) {
	if got := CookieName(32000); got != "gcpui_token_32000" {
		t.Errorf("CookieName = %q", got)
	}
}
