// Package session creates the per-run access token that gates the API. The
// token is printed in the startup URL's fragment (#token), copied into a
// cookie by the web UI, and checked by the API on every request.
package session

import (
	"crypto/rand"
	"fmt"
	"strconv"
)

// NewToken returns a random (version 4) UUID.
func NewToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate access token: %w", err)
	}
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // RFC 9562 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// CookieName is the name of the cookie holding the token. Cookies are shared
// across ports on the same host, so the API port is part of the name to keep
// two gcp-ui instances from overwriting each other's token.
func CookieName(apiPort int) string {
	return "gcpui_token_" + strconv.Itoa(apiPort)
}
