// The access token arrives in the URL fragment (http://localhost:8080/#<uuid>).
// It is copied into a cookie, which the browser then sends with every API
// request, and removed from the address bar.

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// tokenFromFragment returns the token in a location.hash value, or null.
export function tokenFromFragment(hash: string): string | null {
  const t = hash.replace(/^#/, "").trim().toLowerCase();
  return UUID4.test(t) ? t : null;
}

// tokenCookie is the document.cookie assignment storing token. It is a
// session cookie (gone when the browser closes; the token changes on every
// gcp-ui start anyway). SameSite=Strict keeps other sites from sending it.
export function tokenCookie(name: string, token: string): string {
  return `${name}=${token}; Path=/; SameSite=Strict`;
}

// adoptFragmentToken moves a token from the URL fragment into the cookie.
export function adoptFragmentToken(cookieName: string): void {
  const token = tokenFromFragment(location.hash);
  if (location.hash) {
    // Drop the fragment (valid or not) so it is not left in the address bar
    // or replaced into history.
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (token && cookieName) document.cookie = tokenCookie(cookieName, token);
}
