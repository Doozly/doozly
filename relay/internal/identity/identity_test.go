package identity

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// A provider of our own: an RSA key, its JWKS, and tokens signed with it
type fakeIssuer struct {
	key    *rsa.PrivateKey
	server *httptest.Server
}

func newIssuer(t *testing.T) *fakeIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIssuer{key: key}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
		}})
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeIssuer) token(t *testing.T, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.key},
		(&jose.SignerOptions{}).WithHeader("kid", "k1").WithType("JWT"),
	)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(claims)
	sig, err := signer.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := sig.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func claims(iss, aud, sub string, extra map[string]any) map[string]any {
	c := map[string]any{
		"iss": iss, "aud": aud, "sub": sub,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}
	for k, v := range extra {
		c[k] = v
	}
	return c
}

func setup(t *testing.T) (*OIDC, *fakeIssuer, *fakeIssuer) {
	v, google, microsoft, _ := setupAll(t)
	return v, google, microsoft
}

func setupAll(t *testing.T) (*OIDC, *fakeIssuer, *fakeIssuer, *fakeIssuer) {
	google, microsoft, dropbox := newIssuer(t), newIssuer(t), newIssuer(t)
	v := New(context.Background(), Options{
		GoogleClientID:     "g-client",
		MicrosoftClientID:  "m-client",
		DropboxClientID:    "d-client",
		GoogleIssuer:       "https://accounts.example",
		GoogleKeysURL:      google.server.URL,
		MicrosoftIssuerFmt: "https://login.example/%s/v2.0",
		MicrosoftKeysURL:   microsoft.server.URL,
		DropboxIssuer:      "https://dropbox.example",
		DropboxKeysURL:     dropbox.server.URL,
	})
	return v, google, microsoft, dropbox
}

func TestGoogleToken(t *testing.T) {
	v, google, _ := setup(t)
	ctx := context.Background()
	raw := google.token(t, claims("https://accounts.example", "g-client", "123", nil))
	id, err := v.Verify(ctx, "google", raw)
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != "123" || id.UserID != UserID("google", "123") || len(id.UserID) != 64 {
		t.Errorf("%+v", id)
	}

	for name, c := range map[string]map[string]any{
		"other app":    claims("https://accounts.example", "someone-else", "123", nil),
		"other issuer": claims("https://evil.example", "g-client", "123", nil),
		"expired":      claims("https://accounts.example", "g-client", "123", map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}),
	} {
		if _, err := v.Verify(ctx, "google", google.token(t, c)); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestOnlyTheProvidersOwnKeysCount(t *testing.T) {
	v, _, microsoft := setup(t)
	raw := microsoft.token(t, claims("https://accounts.example", "g-client", "123", nil))
	if _, err := v.Verify(context.Background(), "google", raw); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("signed by the wrong key: %v", err)
	}
}

func TestMicrosoftTokenAnyTenant(t *testing.T) {
	v, _, microsoft := setup(t)
	ctx := context.Background()
	raw := microsoft.token(t, claims("https://login.example/tenant-a/v2.0", "m-client", "abc", map[string]any{"tid": "tenant-a"}))
	id, err := v.Verify(ctx, "microsoft", raw)
	if err != nil {
		t.Fatal(err)
	}
	if id.UserID != UserID("microsoft", "abc") {
		t.Errorf("%+v", id)
	}

	// The issuer must be the token's own tenant
	raw = microsoft.token(t, claims("https://login.example/tenant-b/v2.0", "m-client", "abc", map[string]any{"tid": "tenant-a"}))
	if _, err := v.Verify(ctx, "microsoft", raw); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("wrong tenant: %v", err)
	}
	raw = microsoft.token(t, claims("https://login.example/tenant-a/v2.0", "m-client", "abc", nil))
	if _, err := v.Verify(ctx, "microsoft", raw); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("no tenant: %v", err)
	}
}

func TestDropboxToken(t *testing.T) {
	v, _, _, dropbox := setupAll(t)
	ctx := context.Background()
	id, err := v.Verify(ctx, "dropbox", dropbox.token(t, claims("https://dropbox.example", "d-client", "dbid:AAH4", nil)))
	if err != nil {
		t.Fatal(err)
	}
	if id.UserID != UserID("dropbox", "dbid:AAH4") {
		t.Errorf("%+v", id)
	}
	for name, c := range map[string]map[string]any{
		"other app":    claims("https://dropbox.example", "someone-else", "dbid:AAH4", nil),
		"other issuer": claims("https://accounts.example", "d-client", "dbid:AAH4", nil),
	} {
		if _, err := v.Verify(ctx, "dropbox", dropbox.token(t, c)); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestUnknownOrUnconfiguredProvider(t *testing.T) {
	v := New(context.Background(), Options{GoogleClientID: "g"})
	for _, p := range []string{"microsoft", "dropbox", "github", ""} {
		if _, err := v.Verify(context.Background(), p, "x"); !errors.Is(err, ErrUnknownProvider) {
			t.Errorf("%q: %v", p, err)
		}
	}
}

func TestUserIDsDifferPerProvider(t *testing.T) {
	if UserID("google", "1") == UserID("microsoft", "1") {
		t.Error("same sub at two providers must be two users")
	}
}
