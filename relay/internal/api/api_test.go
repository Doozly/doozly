package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"doozly.app/relay/internal/identity"
)

const origin = "https://doozly.app"

type fakeStore struct{ err error }

func (f fakeStore) Ping(context.Context) error { return f.err }

// Accepts "good-<sub>" as an ID token from Google, nothing else
type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, provider, raw string) (identity.Identity, error) {
	if provider != "google" {
		return identity.Identity{}, identity.ErrUnknownProvider
	}
	sub, ok := strings.CutPrefix(raw, "good-")
	if !ok {
		return identity.Identity{}, identity.ErrInvalidToken
	}
	return identity.Identity{Provider: provider, Subject: sub, UserID: identity.UserID(provider, sub)}, nil
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func setup(t *testing.T) (http.Handler, *clock) {
	t.Helper()
	c := &clock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
	h := New(Options{
		Store:          fakeStore{},
		Verifier:       fakeVerifier{},
		Sessions:       Sessions{Key: []byte("0123456789abcdef0123456789abcdef"), TTL: time.Hour},
		AllowedOrigins: []string{origin},
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:            c.now,
	})
	return h, c
}

type req struct {
	method, path, body string
	origin             string
	cookie             *http.Cookie
	remote             string
	headers            map[string]string
}

func do(h http.Handler, q req) *httptest.ResponseRecorder {
	r := httptest.NewRequest(q.method, q.path, strings.NewReader(q.body))
	if q.origin != "" {
		r.Header.Set("Origin", q.origin)
	}
	if q.cookie != nil {
		r.AddCookie(q.cookie)
	}
	if q.remote != "" {
		r.RemoteAddr = q.remote
	}
	for k, v := range q.headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func sessionCookieOf(t *testing.T, w *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}

func TestHealthz(t *testing.T) {
	h, _ := setup(t)
	w := do(h, req{method: "GET", path: "/healthz"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"ok"`) {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("headers %v", w.Header())
	}
	broken := New(Options{Store: fakeStore{err: errors.New("disk")}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if w := do(broken, req{method: "GET", path: "/healthz"}); w.Code != 503 {
		t.Errorf("broken database: %d", w.Code)
	}
}

func TestSessionLifecycle(t *testing.T) {
	h, c := setup(t)
	w := do(h, req{method: "POST", path: "/v1/session", origin: origin, body: `{"provider":"google","idToken":"good-42"}`})
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	cookie := sessionCookieOf(t, w)
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
		t.Errorf("cookie attributes %+v", cookie)
	}
	var got map[string]string
	json.NewDecoder(w.Body).Decode(&got)
	if got["userId"] != identity.UserID("google", "42") {
		t.Errorf("%v", got)
	}

	if w := do(h, req{method: "GET", path: "/v1/session", cookie: cookie}); w.Code != 200 || !strings.Contains(w.Body.String(), got["userId"]) {
		t.Errorf("with cookie: %d %s", w.Code, w.Body)
	}

	// A changed cookie or an expired one is no session
	forged := *cookie
	forged.Value = strings.Replace(cookie.Value, cookie.Value[:4], "AAAA", 1)
	if w := do(h, req{method: "GET", path: "/v1/session", cookie: &forged}); w.Code != 401 {
		t.Errorf("forged: %d", w.Code)
	}
	c.t = c.t.Add(2 * time.Hour)
	if w := do(h, req{method: "GET", path: "/v1/session", cookie: cookie}); w.Code != 401 {
		t.Errorf("expired: %d", w.Code)
	}

	w = do(h, req{method: "DELETE", path: "/v1/session", origin: origin, cookie: cookie})
	if w.Code != 204 || sessionCookieOf(t, w).MaxAge >= 0 {
		t.Errorf("sign out: %d", w.Code)
	}
}

func TestSessionRefusals(t *testing.T) {
	h, _ := setup(t)
	for name, tc := range map[string]struct {
		body   string
		origin string
		code   int
	}{
		"bad token":      {`{"provider":"google","idToken":"forged"}`, origin, 401},
		"other provider": {`{"provider":"github","idToken":"good-1"}`, origin, 400},
		"no token":       {`{"provider":"google"}`, origin, 400},
		"not json":       {`nope`, origin, 400},
		"no origin":      {`{"provider":"google","idToken":"good-1"}`, "", 403},
		"other site":     {`{"provider":"google","idToken":"good-1"}`, "https://evil.example", 403},
	} {
		w := do(h, req{method: "POST", path: "/v1/session", origin: tc.origin, body: tc.body})
		if w.Code != tc.code {
			t.Errorf("%s: %d, want %d", name, w.Code, tc.code)
		}
		if len(w.Result().Cookies()) > 0 {
			t.Errorf("%s: set a cookie", name)
		}
	}
}

func TestCORS(t *testing.T) {
	h, _ := setup(t)
	pre := do(h, req{method: "OPTIONS", path: "/v1/session", origin: origin, headers: map[string]string{
		"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
	}})
	if pre.Code != 204 || pre.Header().Get("Access-Control-Allow-Origin") != origin ||
		pre.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("preflight: %d %v", pre.Code, pre.Header())
	}
	evil := do(h, req{method: "OPTIONS", path: "/v1/session", origin: "https://evil.example", headers: map[string]string{
		"Access-Control-Request-Method": "POST",
	}})
	if evil.Code != 403 || evil.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("evil preflight: %d %v", evil.Code, evil.Header())
	}
}

func TestRateLimitPerIP(t *testing.T) {
	h, c := setup(t)
	hit := func(remote string, headers map[string]string) int {
		return do(h, req{method: "GET", path: "/v1/session", remote: remote, headers: headers}).Code
	}
	for range 30 {
		if code := hit("203.0.113.1:1234", nil); code != 401 {
			t.Fatalf("within the burst: %d", code)
		}
	}
	if code := hit("203.0.113.1:1234", nil); code != 429 {
		t.Errorf("over the burst: %d", code)
	}
	if code := hit("203.0.113.2:1234", nil); code != 401 {
		t.Errorf("another IP has its own bucket: %d", code)
	}
	// A made-up CF-Connecting-IP from an untrusted peer changes nothing
	if code := hit("203.0.113.1:1234", map[string]string{"CF-Connecting-IP": "198.51.100.9"}); code != 429 {
		t.Errorf("spoofed header: %d", code)
	}
	if code := do(h, req{method: "GET", path: "/healthz", remote: "203.0.113.1:1234"}).Code; code != 200 {
		t.Errorf("healthz is never limited: %d", code)
	}
	c.t = c.t.Add(2 * time.Second)
	if code := hit("203.0.113.1:1234", nil); code != 401 {
		t.Errorf("refilled: %d", code)
	}
}

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	for _, tc := range []struct{ remote, cf, want string }{
		{"127.0.0.1:5000", "198.51.100.9", "198.51.100.9"},
		{"127.0.0.1:5000", "garbage", "127.0.0.1"},
		{"203.0.113.1:5000", "198.51.100.9", "203.0.113.1"},
		{"[::ffff:127.0.0.1]:5000", "2001:db8::1", "2001:db8::1"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tc.remote
		r.Header.Set("CF-Connecting-IP", tc.cf)
		if got := clientIP(r, trusted).String(); got != tc.want {
			t.Errorf("%s via %s: %s, want %s", tc.cf, tc.remote, got, tc.want)
		}
	}
}

func TestLimiterForgetsIdleBuckets(t *testing.T) {
	c := &clock{t: time.Unix(0, 0)}
	l := newLimiter(1, 1, c.now)
	l.allow("a")
	c.t = c.t.Add(11 * time.Minute)
	l.allow("b")
	if _, ok := l.buckets["a"]; ok || len(l.buckets) != 1 {
		t.Errorf("buckets: %v", l.buckets)
	}
}

func TestPanicsBecome500(t *testing.T) {
	s := &server{Options: Options{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}}
	h := s.recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	if w := do(h, req{method: "GET", path: "/"}); w.Code != 500 {
		t.Errorf("%d", w.Code)
	}
}
