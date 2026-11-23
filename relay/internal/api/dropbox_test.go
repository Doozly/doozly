package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"doozly.app/relay/internal/dropbox"
	"doozly.app/relay/internal/identity"
)

// Code "good" with verifier "v" works, "no-rt" gives no refresh token; refresh token "rt" works, "revoked" doesn't
type fakeDropbox struct{}

func (fakeDropbox) Exchange(_ context.Context, code, verifier, _ string) (dropbox.Tokens, error) {
	switch {
	case code == "down":
		return dropbox.Tokens{}, errors.New("connection refused")
	case verifier != "v":
		return dropbox.Tokens{}, dropbox.ErrInvalidGrant
	case code == "good":
		return dropbox.Tokens{AccessToken: "at1", ExpiresIn: 14400, RefreshToken: "rt", IDToken: "good-dbid:9", Scope: "s"}, nil
	case code == "no-rt":
		return dropbox.Tokens{AccessToken: "at1", ExpiresIn: 14400, IDToken: "good-dbid:9", Scope: "s"}, nil
	case code == "bad-id":
		return dropbox.Tokens{AccessToken: "at1", ExpiresIn: 14400, IDToken: "forged"}, nil
	}
	return dropbox.Tokens{}, dropbox.ErrInvalidGrant
}

func (fakeDropbox) Refresh(_ context.Context, rt string) (dropbox.Tokens, error) {
	switch rt {
	case "rt":
		return dropbox.Tokens{AccessToken: "at2", ExpiresIn: 14400, Scope: "s"}, nil
	case "down":
		return dropbox.Tokens{}, errors.New("timeout")
	}
	return dropbox.Tokens{}, dropbox.ErrInvalidGrant
}

// Like fakeVerifier, for Dropbox's ID tokens
type dropboxVerifier struct{}

func (dropboxVerifier) Verify(_ context.Context, provider, raw string) (identity.Identity, error) {
	if provider != "dropbox" {
		return identity.Identity{}, identity.ErrUnknownProvider
	}
	sub, ok := strings.CutPrefix(raw, "good-")
	if !ok {
		return identity.Identity{}, identity.ErrInvalidToken
	}
	return identity.Identity{Provider: provider, Subject: sub, UserID: identity.UserID(provider, sub)}, nil
}

func setupDropbox(t *testing.T) (http.Handler, *sealer) {
	t.Helper()
	key := []byte("0123456789abcdef0123456789abcdef")
	h := New(Options{
		Store:          fakeStore{},
		Verifier:       dropboxVerifier{},
		Sessions:       Sessions{Key: key, TTL: time.Hour},
		Dropbox:        fakeDropbox{},
		AllowedOrigins: []string{origin},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	sealer, _ := newDropboxSealer(key)
	return h, sealer
}

func dropboxCode(code string) string {
	b, _ := json.Marshal(map[string]string{"code": code, "verifier": "v", "redirectUri": origin + "/redirect.html"})
	return string(b)
}

func TestDropboxCodeExchange(t *testing.T) {
	h, s := setupDropbox(t)
	w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", origin: origin, body: dropboxCode("good")})
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	got := body(t, w)
	if got["accessToken"] != "at1" || got["expiresIn"] != 14400.0 || got["persistent"] != true ||
		got["userId"] != identity.UserID("dropbox", "dbid:9") {
		t.Errorf("%v", got)
	}
	if cookieNamed(w, sessionCookie) == nil {
		t.Error("no session cookie")
	}
	rc := cookieNamed(w, dropboxCookie)
	if rc == nil || rc.Path != "/v1/auth/dropbox" || !rc.HttpOnly || !rc.Secure || rc.SameSite != http.SameSiteStrictMode {
		t.Fatalf("refresh cookie %+v", rc)
	}
	plain, ok := s.open(rc.Value)
	if !ok || plain == "" || rc.Value == plain {
		t.Errorf("the refresh token must be sealed, got %q", rc.Value)
	}
}

func TestDropboxWithoutRefreshToken(t *testing.T) {
	h, _ := setupDropbox(t)
	w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", origin: origin, body: dropboxCode("no-rt")})
	if w.Code != 200 || body(t, w)["persistent"] != false || cookieNamed(w, dropboxCookie) != nil {
		t.Errorf("%d, cookie %v", w.Code, cookieNamed(w, dropboxCookie))
	}
}

func TestDropboxExchangeFailures(t *testing.T) {
	h, _ := setupDropbox(t)
	for code, want := range map[string]int{"used": 400, "down": 502, "bad-id": 502} {
		w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", origin: origin, body: dropboxCode(code)})
		if w.Code != want || cookieNamed(w, sessionCookie) != nil {
			t.Errorf("%s: %d, want %d", code, w.Code, want)
		}
	}
	for name, b := range map[string]string{
		"no verifier":         `{"code":"good","redirectUri":"https://doozly.app/redirect.html"}`,
		"another site's page": `{"code":"good","verifier":"v","redirectUri":"https://evil.example/redirect.html"}`,
		"no redirect":         `{"code":"good","verifier":"v"}`,
	} {
		if w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", origin: origin, body: b}); w.Code != 400 {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	if w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", body: dropboxCode("good")}); w.Code != 403 {
		t.Errorf("without an origin: %d", w.Code)
	}
}

func TestDropboxRefresh(t *testing.T) {
	h, s := setupDropbox(t)
	refresh := func(c *http.Cookie) *httptest.ResponseRecorder {
		return do(h, req{method: "POST", path: "/v1/auth/dropbox/refresh", origin: origin, cookie: c})
	}
	sealed := func(rt string) *http.Cookie {
		g, _ := json.Marshal(dropboxGrant{rt, "user-1"})
		return &http.Cookie{Name: dropboxCookie, Value: s.seal(string(g))}
	}

	w := refresh(sealed("rt"))
	if w.Code != 200 || body(t, w)["accessToken"] != "at2" {
		t.Errorf("good cookie: %d", w.Code)
	}
	// No ID token on refresh, the session comes from the user id in the cookie
	if cookieNamed(w, sessionCookie) == nil {
		t.Error("session not renewed")
	}
	if w := refresh(nil); w.Code != 401 {
		t.Errorf("no cookie: %d", w.Code)
	}
	if w := refresh(&http.Cookie{Name: dropboxCookie, Value: s.seal("not json")}); w.Code != 401 {
		t.Errorf("garbled cookie: %d", w.Code)
	}
	w = refresh(sealed("revoked"))
	if c := cookieNamed(w, dropboxCookie); w.Code != 401 || c == nil || c.MaxAge >= 0 {
		t.Errorf("revoked at Dropbox: %d, cookie %v", w.Code, c)
	}
	w = refresh(sealed("down"))
	if w.Code != 502 || cookieNamed(w, dropboxCookie) != nil {
		t.Errorf("Dropbox down keeps the cookie: %d", w.Code)
	}
}

func TestDropboxSignOutClearsBothCookies(t *testing.T) {
	h, _ := setupDropbox(t)
	w := do(h, req{method: "DELETE", path: "/v1/auth/dropbox", origin: origin})
	rc, sc := cookieNamed(w, dropboxCookie), cookieNamed(w, sessionCookie)
	if w.Code != 204 || rc == nil || rc.MaxAge >= 0 || sc == nil || sc.MaxAge >= 0 {
		t.Errorf("%d %v %v", w.Code, rc, sc)
	}
}

func TestDropboxEndpointsNeedAClient(t *testing.T) {
	h, _ := setup(t)
	if w := do(h, req{method: "POST", path: "/v1/auth/dropbox/token", origin: origin, body: dropboxCode("good")}); w.Code != 404 {
		t.Errorf("%d", w.Code)
	}
}
