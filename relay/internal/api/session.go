package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// __Host- makes the browser insist on Secure, Path=/ and no Domain
const sessionCookie = "__Host-doozly-session"

// Sessions are signed cookies with the user id and an expiry. The relay keeps no state for them.
type Sessions struct {
	Key []byte
	TTL time.Duration
	Now func() time.Time
}

var b64 = base64.RawURLEncoding

func (s Sessions) sign(payload string) string {
	mac := hmac.New(sha256.New, s.Key)
	mac.Write([]byte(payload))
	return b64.EncodeToString(mac.Sum(nil))
}

func (s Sessions) Issue(w http.ResponseWriter, userID string) {
	expires := s.Now().Add(s.TTL)
	payload := b64.EncodeToString([]byte(userID + "|" + strconv.FormatInt(expires.Unix(), 10)))
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    payload + "." + s.sign(payload),
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(s.TTL.Seconds()),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// User gives the signed-in user id, or "" when there's no valid session.
func (s Sessions) User(r *http.Request) string {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return ""
	}
	payload, sig, ok := strings.Cut(c.Value, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(s.sign(payload))) {
		return ""
	}
	raw, err := b64.DecodeString(payload)
	if err != nil {
		return ""
	}
	userID, exp, ok := strings.Cut(string(raw), "|")
	unix, err := strconv.ParseInt(exp, 10, 64)
	if !ok || err != nil || userID == "" || !s.Now().Before(time.Unix(unix, 0)) {
		return ""
	}
	return userID
}

func (s Sessions) Clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}
