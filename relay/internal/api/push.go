package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"doozly.app/relay/internal/store"
)

type PushStore interface {
	PutSubscription(ctx context.Context, sub store.Subscription, now time.Time) error
	DeleteSubscription(ctx context.Context, userID, endpoint string) error
	ReplaceReminders(ctx context.Context, userID string, rs []store.Reminder, now time.Time) error
}

// Only the browsers' own push services. Anything else would let a signed-in user make
// the relay post to any address they like.
var pushHosts = []string{
	"fcm.googleapis.com", // Chrome, Edge on Android, most Chromium
	"updates.push.services.mozilla.com",
	"push.apple.com",     // web.push.apple.com, Safari and iOS
	"notify.windows.com", // Edge on Windows (wns2-*.notify.windows.com)
}

const (
	maxReminders = 1000
	// A push message must fit in 4 kB with its encryption, the id and the JSON around it
	maxPayload = 2048
)

func pushHostAllowed(endpoint string) bool {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

// keyOf decodes a subscription key, which browsers give as base64url, sometimes padded
func keyOf(s string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		return nil
	}
	return b
}

func (s *server) pushKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": s.VAPIDPublicKey})
}

// PUT /v1/push/subscription takes PushSubscription.toJSON() as the browser makes it
func (s *server) putSubscription(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Endpoint) > 1024 {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	if !pushHostAllowed(body.Endpoint) {
		fail(w, http.StatusBadRequest, "push_service")
		return
	}
	if len(keyOf(body.Keys.P256dh)) != 65 || len(keyOf(body.Keys.Auth)) != 16 {
		fail(w, http.StatusBadRequest, "bad_keys")
		return
	}
	sub := store.Subscription{
		Endpoint: body.Endpoint,
		UserID:   r.Context().Value(userKey).(string),
		P256dh:   body.Keys.P256dh,
		Auth:     body.Keys.Auth,
	}
	if err := s.Push.PutSubscription(r.Context(), sub, s.Now()); err != nil {
		s.Log.Error("saving subscription", "err", err)
		fail(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /v1/push/subscription {"endpoint": "..."}
func (s *server) deleteSubscription(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	user := r.Context().Value(userKey).(string)
	if err := s.Push.DeleteSubscription(r.Context(), user, body.Endpoint); err != nil {
		s.Log.Error("removing subscription", "err", err)
		fail(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PUT /v1/reminders {"reminders": [{"id", "fireAt" (epoch ms), "payload" (base64)}]} replaces the whole set
func (s *server) putReminders(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reminders []struct {
			ID      string `json:"id"`
			FireAt  int64  `json:"fireAt"`
			Payload []byte `json:"payload"` // encoding/json takes it as standard base64
		} `json:"reminders"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Reminders == nil {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	if len(body.Reminders) > maxReminders {
		fail(w, http.StatusRequestEntityTooLarge, "too_many")
		return
	}
	rs := make([]store.Reminder, 0, len(body.Reminders))
	for _, in := range body.Reminders {
		if in.ID == "" || len(in.ID) > 128 || in.FireAt <= 0 || len(in.Payload) == 0 || len(in.Payload) > maxPayload {
			fail(w, http.StatusBadRequest, "bad_reminder")
			return
		}
		rs = append(rs, store.Reminder{ID: in.ID, FireAt: in.FireAt, Payload: in.Payload})
	}
	user := r.Context().Value(userKey).(string)
	if err := s.Push.ReplaceReminders(r.Context(), user, rs, s.Now()); err != nil {
		s.Log.Error("saving reminders", "err", err)
		fail(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
