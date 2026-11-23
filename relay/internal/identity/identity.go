package identity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
)

var (
	ErrUnknownProvider = errors.New("unknown or unconfigured provider")
	ErrInvalidToken    = errors.New("invalid ID token")
)

type Identity struct {
	Provider string
	Subject  string
	// UserID is what the relay stores, never the provider's own id
	UserID string
}

type Verifier interface {
	Verify(ctx context.Context, provider, rawIDToken string) (Identity, error)
}

// Options are the client IDs, plus endpoints a test can point elsewhere.
type Options struct {
	GoogleClientID    string
	MicrosoftClientID string
	DropboxClientID   string

	GoogleIssuer       string
	GoogleKeysURL      string
	MicrosoftIssuerFmt string // with one %s for the tenant id
	MicrosoftKeysURL   string
	DropboxIssuer      string
	DropboxKeysURL     string
}

func (o *Options) defaults() {
	if o.GoogleIssuer == "" {
		o.GoogleIssuer = "https://accounts.google.com"
	}
	if o.GoogleKeysURL == "" {
		o.GoogleKeysURL = "https://www.googleapis.com/oauth2/v3/certs"
	}
	if o.MicrosoftIssuerFmt == "" {
		o.MicrosoftIssuerFmt = "https://login.microsoftonline.com/%s/v2.0"
	}
	if o.MicrosoftKeysURL == "" {
		o.MicrosoftKeysURL = "https://login.microsoftonline.com/common/discovery/v2.0/keys"
	}
	if o.DropboxIssuer == "" {
		o.DropboxIssuer = "https://www.dropbox.com"
	}
	if o.DropboxKeysURL == "" {
		o.DropboxKeysURL = "https://www.dropbox.com/.well-known/jwks"
	}
}

// OIDC checks ID tokens against the providers' published keys (JWKS), fetched and cached by go-oidc.
type OIDC struct {
	google       *oidc.IDTokenVerifier
	microsoft    *oidc.IDTokenVerifier
	dropbox      *oidc.IDTokenVerifier
	microsoftIss string
}

// New keeps ctx for fetching keys later, so give it one that lives as long as the server.
func New(ctx context.Context, o Options) *OIDC {
	o.defaults()
	v := &OIDC{microsoftIss: o.MicrosoftIssuerFmt}
	if o.GoogleClientID != "" {
		keys := oidc.NewRemoteKeySet(ctx, o.GoogleKeysURL)
		v.google = oidc.NewVerifier(o.GoogleIssuer, keys, &oidc.Config{ClientID: o.GoogleClientID})
	}
	if o.MicrosoftClientID != "" {
		// Every tenant has its own issuer, so we check it ourselves against the token's tid
		keys := oidc.NewRemoteKeySet(ctx, o.MicrosoftKeysURL)
		v.microsoft = oidc.NewVerifier("", keys, &oidc.Config{
			ClientID:        o.MicrosoftClientID,
			SkipIssuerCheck: true,
		})
	}
	if o.DropboxClientID != "" {
		keys := oidc.NewRemoteKeySet(ctx, o.DropboxKeysURL)
		v.dropbox = oidc.NewVerifier(o.DropboxIssuer, keys, &oidc.Config{ClientID: o.DropboxClientID})
	}
	return v
}

func (v *OIDC) Verify(ctx context.Context, provider, raw string) (Identity, error) {
	var verifier *oidc.IDTokenVerifier
	switch provider {
	case "google":
		verifier = v.google
	case "microsoft":
		verifier = v.microsoft
	case "dropbox":
		verifier = v.dropbox
	}
	if verifier == nil {
		return Identity{}, ErrUnknownProvider
	}
	token, err := verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	if provider == "microsoft" {
		var claims struct {
			TenantID string `json:"tid"`
		}
		if err := token.Claims(&claims); err != nil || claims.TenantID == "" {
			return Identity{}, fmt.Errorf("%w: no tenant", ErrInvalidToken)
		}
		if token.Issuer != fmt.Sprintf(v.microsoftIss, claims.TenantID) {
			return Identity{}, fmt.Errorf("%w: issuer %q doesn't fit tenant", ErrInvalidToken, token.Issuer)
		}
	}
	if token.Subject == "" {
		return Identity{}, fmt.Errorf("%w: no subject", ErrInvalidToken)
	}
	return Identity{Provider: provider, Subject: token.Subject, UserID: UserID(provider, token.Subject)}, nil
}

// UserID is stable per provider account, and doesn't give away the provider's id.
func UserID(provider, subject string) string {
	sum := sha256.Sum256([]byte(provider + ":" + subject))
	return hex.EncodeToString(sum[:])
}
