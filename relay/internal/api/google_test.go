package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"doozly.app/relay/internal/google"
	"doozly.app/relay/internal/identity"
)

// Codes "with-rt" and "no-rt" work, refresh token "rt" works, "revoked" doesn't, "down" fails
type fakeGoogle struct{}

func (fakeGoogle) Exchange(_ context.Context, code string) (google.Tokens, error) {
	switch code {
	case "with-rt":
		return google.Tokens{AccessToken: "at1", ExpiresIn: 3599, RefreshToken: "rt", IDToken: "good-7", Scope: "s"}, nil
	case "no-rt":
		return google.Tokens{AccessToken: "at1", ExpiresIn: 3599, IDToken: "good-7", Scope: "s"}, nil
	case "bad-id":
		return google.Tokens{AccessToken: "at1", ExpiresIn: 3599, IDToken: "forged"}, nil
	case "down":
		return google.Tokens{}, errors.New("connection refused")
	}
	return google.Tokens{}, google.ErrInvalidGrant
}

func (fakeGoogle) Refresh(_ context.Context, rt string) (google.Tokens, error) {
	switch rt {
	case "rt":
		return google.Tokens{AccessToken: "at2", ExpiresIn: 3599, Scope: "s"}, nil
	case "rt-openid":
		return google.Tokens{AccessToken: "at2", ExpiresIn: 3599, IDToken: "good-7", Scope: "s"}, nil
	case "down":
		return google.Tokens{}, errors.New("timeout")
	}
	return google.Tokens{}, google.ErrInvalidGrant
}

func setupGoogle(t *testing.T) (http.Handler, *server) {
	t.Helper()
	h := New(Options{
		Store:          fakeStore{},
		Verifier:       fakeVerifier{},
		Sessions:       Sessions{Key: []byte("0123456789abcdef0123456789abcdef"), TTL: time.Hour},
		Google:         fakeGoogle{},
		AllowedOrigins: []string{origin},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	// Same key, so the test can seal cookies like the server does
	sealer, _ := newSealer([]byte("0123456789abcdef0123456789abcdef"))
	return h, &server{sealer: sealer}
}

func cookieNamed(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func body(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(w.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestGoogleCodeExchange(t *testing.T) {
	h, _ := setupGoogle(t)
	w := do(h, req{method: "POST", path: "/v1/auth/google/token", origin: origin, body: `{"code":"with-rt"}`})
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	got := body(t, w)
	if got["accessToken"] != "at1" || got["expiresIn"] != 3599.0 || got["persistent"] != true ||
		got["userId"] != identity.UserID("google", "7") {
		t.Errorf("%v", got)
	}
	if cookieNamed(w, sessionCookie) == nil {
		t.Error("no session cookie")
	}
	rc := cookieNamed(w, refreshCookie)
	if rc == nil || rc.Path != "/v1/auth/google" || !rc.HttpOnly || !rc.Secure || rc.SameSite != http.SameSiteStrictMode {
		t.Fatalf("refresh cookie %+v", rc)
	}
	if rc.Value == "rt" || len(rc.Value) < 20 {
		t.Errorf("the refresh token must be sealed, got %q", rc.Value)
	}
}

func TestGoogleWithoutRefreshToken(t *testing.T) {
	h, _ := setupGoogle(t)
	w := do(h, req{method: "POST", path: "/v1/auth/google/token", origin: origin, body: `{"code":"no-rt"}`})
	if w.Code != 200 || body(t, w)["persistent"] != false || cookieNamed(w, refreshCookie) != nil {
		t.Errorf("%d, cookie %v", w.Code, cookieNamed(w, refreshCookie))
	}
}

func TestGoogleExchangeFailures(t *testing.T) {
	h, _ := setupGoogle(t)
	for code, want := range map[string]int{"used": 400, "down": 502, "bad-id": 502} {
		w := do(h, req{method: "POST", path: "/v1/auth/google/token", origin: origin, body: `{"code":"` + code + `"}`})
		if w.Code != want || cookieNamed(w, sessionCookie) != nil {
			t.Errorf("%s: %d, want %d", code, w.Code, want)
		}
	}
	if w := do(h, req{method: "POST", path: "/v1/auth/google/token", body: `{"code":"with-rt"}`}); w.Code != 403 {
		t.Errorf("without an origin: %d", w.Code)
	}
}

func TestGoogleRefresh(t *testing.T) {
	h, s := setupGoogle(t)
	refresh := func(c *http.Cookie) *httptest.ResponseRecorder {
		return do(h, req{method: "POST", path: "/v1/auth/google/refresh", origin: origin, cookie: c})
	}
	sealed := func(rt string) *http.Cookie { return &http.Cookie{Name: refreshCookie, Value: s.sealer.seal(rt)} }

	w := refresh(sealed("rt"))
	if w.Code != 200 || body(t, w)["accessToken"] != "at2" {
		t.Errorf("good cookie: %d", w.Code)
	}
	if cookieNamed(w, sessionCookie) != nil {
		t.Error("no ID token, so no new session")
	}
	// With an ID token from Google the relay session gets renewed too
	if w := refresh(sealed("rt-openid")); w.Code != 200 || cookieNamed(w, sessionCookie) == nil {
		t.Errorf("session not renewed: %d", w.Code)
	}
	if w := refresh(nil); w.Code != 401 {
		t.Errorf("no cookie: %d", w.Code)
	}
	if w := refresh(&http.Cookie{Name: refreshCookie, Value: "rt"}); w.Code != 401 {
		t.Errorf("unsealed cookie: %d", w.Code)
	}
	w = refresh(sealed("revoked"))
	if c := cookieNamed(w, refreshCookie); w.Code != 401 || c == nil || c.MaxAge >= 0 {
		t.Errorf("revoked at Google: %d, cookie %v", w.Code, c)
	}
	w = refresh(sealed("down"))
	if w.Code != 502 || cookieNamed(w, refreshCookie) != nil {
		t.Errorf("Google down keeps the cookie: %d", w.Code)
	}
}

func TestGoogleSignOutClearsBothCookies(t *testing.T) {
	h, _ := setupGoogle(t)
	w := do(h, req{method: "DELETE", path: "/v1/auth/google", origin: origin})
	rc, sc := cookieNamed(w, refreshCookie), cookieNamed(w, sessionCookie)
	if w.Code != 204 || rc == nil || rc.MaxAge >= 0 || sc == nil || sc.MaxAge >= 0 {
		t.Errorf("%d %v %v", w.Code, rc, sc)
	}
}

func TestGoogleEndpointsNeedASecret(t *testing.T) {
	h, _ := setup(t)
	if w := do(h, req{method: "POST", path: "/v1/auth/google/token", origin: origin, body: `{"code":"with-rt"}`}); w.Code != 404 {
		t.Errorf("%d", w.Code)
	}
}

func TestSealerRoundTrip(t *testing.T) {
	a, _ := newSealer([]byte("0123456789abcdef0123456789abcdef"))
	b, _ := newSealer([]byte("another key, another key, anoth!"))
	sealed := a.seal("secret")
	if got, ok := a.open(sealed); !ok || got != "secret" {
		t.Errorf("%q %v", got, ok)
	}
	if _, ok := b.open(sealed); ok {
		t.Error("another key mustn't open it")
	}
	if a.seal("secret") == sealed {
		t.Error("every seal needs a fresh nonce")
	}
}
