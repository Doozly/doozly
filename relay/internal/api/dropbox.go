package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"

	"doozly.app/relay/internal/dropbox"
)

type DropboxTokens interface {
	Exchange(ctx context.Context, code, verifier, redirectURI string) (dropbox.Tokens, error)
	Refresh(ctx context.Context, refreshToken string) (dropbox.Tokens, error)
}

const dropboxCookie = "__Secure-doozly-dropbox"
const dropboxPath = "/v1/auth/dropbox"

func newDropboxSealer(sessionKey []byte) (*sealer, error) {
	return newSealer(sessionKey, "doozly dropbox refresh cookie", dropboxCookie)
}

// What the cookie holds. Dropbox sends no ID token on refresh, so the user id comes along for the session.
type dropboxGrant struct {
	RefreshToken string `json:"rt"`
	UserID       string `json:"uid"`
}

func (s *server) setDropboxCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     dropboxCookie,
		Value:    value,
		Path:     dropboxPath,
		MaxAge:   maxAge,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// POST /v1/auth/dropbox/token {"code", "verifier", "redirectUri"}: the popup's PKCE code for an access token,
// a session, and the refresh token sealed in a cookie so this browser stays signed in.
func (s *server) dropboxToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code        string `json:"code"`
		Verifier    string `json:"verifier"`
		RedirectURI string `json:"redirectUri"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" || body.Verifier == "" {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	// The popup came back to the app that asks, nowhere else
	if u, err := url.Parse(body.RedirectURI); err != nil || u.Scheme+"://"+u.Host != r.Header.Get("Origin") {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	tokens, err := s.Dropbox.Exchange(r.Context(), body.Code, body.Verifier, body.RedirectURI)
	if errors.Is(err, dropbox.ErrInvalidGrant) {
		fail(w, http.StatusBadRequest, "invalid_code")
		return
	}
	if err != nil {
		s.Log.Error("dropbox code exchange", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	id, err := s.Verifier.Verify(r.Context(), "dropbox", tokens.IDToken)
	if err != nil {
		s.Log.Error("dropbox sent an ID token we can't verify", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	if !s.perUser.allow(id.UserID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	s.Sessions.Issue(w, id.UserID)
	s.Log.Info("dropbox sign-in", "persistent", tokens.RefreshToken != "")
	if tokens.RefreshToken != "" {
		grant, _ := json.Marshal(dropboxGrant{tokens.RefreshToken, id.UserID})
		s.setDropboxCookie(w, s.dropbox.seal(string(grant)), int(refreshTTL.Seconds()))
	}
	writeJSON(w, http.StatusOK, struct {
		accessToken
		UserID     string `json:"userId"`
		Persistent bool   `json:"persistent"`
	}{
		accessToken{tokens.AccessToken, tokens.ExpiresIn, tokens.Scope},
		id.UserID,
		tokens.RefreshToken != "",
	})
}

func (s *server) dropboxGrant(r *http.Request) (dropboxGrant, bool) {
	var g dropboxGrant
	c, err := r.Cookie(dropboxCookie)
	if err != nil {
		return g, false
	}
	plain, ok := s.dropbox.open(c.Value)
	if !ok || json.Unmarshal([]byte(plain), &g) != nil || g.RefreshToken == "" || g.UserID == "" {
		return g, false
	}
	return g, true
}

// POST /v1/auth/dropbox/refresh: a fresh access token from the cookie's refresh token, and a renewed session
func (s *server) dropboxRefresh(w http.ResponseWriter, r *http.Request) {
	g, ok := s.dropboxGrant(r)
	if !ok {
		fail(w, http.StatusUnauthorized, "signed_out")
		return
	}
	tokens, err := s.Dropbox.Refresh(r.Context(), g.RefreshToken)
	if errors.Is(err, dropbox.ErrInvalidGrant) {
		// Revoked at Dropbox, like when the user unlinked the app: sign in again
		s.setDropboxCookie(w, "", -1)
		fail(w, http.StatusUnauthorized, "signed_out")
		return
	}
	if err != nil {
		s.Log.Error("dropbox refresh", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	s.Sessions.Issue(w, g.UserID)
	writeJSON(w, http.StatusOK, accessToken{tokens.AccessToken, tokens.ExpiresIn, tokens.Scope})
}

// DELETE /v1/auth/dropbox: sign this browser out. No revoke, that would unlink the app on every device.
func (s *server) dropboxSignOut(w http.ResponseWriter, r *http.Request) {
	s.setDropboxCookie(w, "", -1)
	s.Sessions.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}
