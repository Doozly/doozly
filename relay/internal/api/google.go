package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"doozly.app/relay/internal/google"
)

type GoogleTokens interface {
	Exchange(ctx context.Context, code string) (google.Tokens, error)
	Refresh(ctx context.Context, refreshToken string) (google.Tokens, error)
}

// Only sent to the Google auth endpoints. __Secure- because __Host- would need Path=/.
const refreshCookie = "__Secure-doozly-google"
const refreshPath = "/v1/auth/google"

// Refresh tokens of published apps last until revoked; the cookie gives up a bit earlier
const refreshTTL = 180 * 24 * time.Hour

// sealer encrypts the refresh token for the cookie, so a copied cookie jar doesn't hand it out in clear
type sealer struct{ aead cipher.AEAD }

func newSealer(sessionKey []byte) (*sealer, error) {
	key, err := hkdf.Key(sha256.New, sessionKey, nil, "doozly google refresh cookie", 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sealer{aead: aead}, nil
}

func (s *sealer) seal(plain string) string {
	nonce := make([]byte, s.aead.NonceSize())
	rand.Read(nonce)
	return b64.EncodeToString(s.aead.Seal(nonce, nonce, []byte(plain), []byte(refreshCookie)))
}

func (s *sealer) open(sealed string) (string, bool) {
	raw, err := b64.DecodeString(sealed)
	if err != nil || len(raw) < s.aead.NonceSize() {
		return "", false
	}
	nonce, box := raw[:s.aead.NonceSize()], raw[s.aead.NonceSize():]
	plain, err := s.aead.Open(nil, nonce, box, []byte(refreshCookie))
	return string(plain), err == nil
}

func (s *server) setRefreshCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    value,
		Path:     refreshPath,
		MaxAge:   maxAge,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

type accessToken struct {
	AccessToken string `json:"accessToken"`
	ExpiresIn   int    `json:"expiresIn"`
	Scope       string `json:"scope"`
}

// POST /v1/auth/google/token {"code"}: the code from GIS's popup for tokens, a session and,
// when Google sends one, a refresh token in a cookie so this browser stays signed in.
func (s *server) googleToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	tokens, err := s.Google.Exchange(r.Context(), body.Code)
	if errors.Is(err, google.ErrInvalidGrant) {
		fail(w, http.StatusBadRequest, "invalid_code")
		return
	}
	if err != nil {
		s.Log.Error("google code exchange", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	id, err := s.Verifier.Verify(r.Context(), "google", tokens.IDToken)
	if err != nil {
		s.Log.Error("google sent an ID token we can't verify", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	if !s.perUser.allow(id.UserID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	s.Sessions.Issue(w, id.UserID)
	s.Log.Info("google sign-in", "persistent", tokens.RefreshToken != "")
	if tokens.RefreshToken != "" {
		s.setRefreshCookie(w, s.sealer.seal(tokens.RefreshToken), int(refreshTTL.Seconds()))
	}
	writeJSON(w, http.StatusOK, struct {
		accessToken
		UserID     string `json:"userId"`
		Persistent bool   `json:"persistent"`
	}{
		accessToken{tokens.AccessToken, tokens.ExpiresIn, tokens.Scope},
		id.UserID,
		// Google only hands out a refresh token now and then, without one this browser is back to hourly
		tokens.RefreshToken != "",
	})
}

func (s *server) refreshToken(r *http.Request) (string, bool) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		return "", false
	}
	return s.sealer.open(c.Value)
}

// POST /v1/auth/google/refresh: a fresh access token from the cookie's refresh token
func (s *server) googleRefresh(w http.ResponseWriter, r *http.Request) {
	rt, ok := s.refreshToken(r)
	if !ok {
		fail(w, http.StatusUnauthorized, "signed_out")
		return
	}
	tokens, err := s.Google.Refresh(r.Context(), rt)
	if errors.Is(err, google.ErrInvalidGrant) {
		// Revoked or expired at Google: this browser has to sign in again
		s.setRefreshCookie(w, "", -1)
		fail(w, http.StatusUnauthorized, "signed_out")
		return
	}
	if err != nil {
		s.Log.Error("google refresh", "err", err)
		fail(w, http.StatusBadGateway, "upstream")
		return
	}
	writeJSON(w, http.StatusOK, accessToken{tokens.AccessToken, tokens.ExpiresIn, tokens.Scope})
}

// DELETE /v1/auth/google: sign this browser out. No revoke at Google, that would end
// the whole grant and sign the user out on every other device too.
func (s *server) googleSignOut(w http.ResponseWriter, r *http.Request) {
	s.setRefreshCookie(w, "", -1)
	s.Sessions.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}
