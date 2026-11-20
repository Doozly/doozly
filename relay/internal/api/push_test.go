package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"doozly.app/relay/internal/identity"
	"doozly.app/relay/internal/store"
)

func setupPush(t *testing.T) (http.Handler, *store.Store, *http.Cookie) {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "relay.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	h := New(Options{
		Store:          db,
		Verifier:       fakeVerifier{},
		Sessions:       Sessions{Key: []byte("0123456789abcdef0123456789abcdef"), TTL: time.Hour},
		Push:           db,
		VAPIDPublicKey: "BPublicKey",
		AllowedOrigins: []string{origin},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:            func() time.Time { return now },
	})
	w := do(h, req{method: "POST", path: "/v1/session", origin: origin, body: `{"provider":"google","idToken":"good-42"}`})
	return h, db, sessionCookieOf(t, w)
}

var (
	p256dh = base64.RawURLEncoding.EncodeToString(append([]byte{4}, make([]byte, 64)...))
	auth   = base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	user42 = identity.UserID("google", "42")
)

func subscription(endpoint string) string {
	return fmt.Sprintf(`{"endpoint":%q,"keys":{"p256dh":%q,"auth":%q}}`, endpoint, p256dh, auth)
}

func TestPushKeyIsPublic(t *testing.T) {
	h, _, _ := setupPush(t)
	w := do(h, req{method: "GET", path: "/v1/push/key"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"publicKey":"BPublicKey"`) {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}

func TestSubscribeAndUnsubscribe(t *testing.T) {
	h, db, cookie := setupPush(t)
	endpoint := "https://fcm.googleapis.com/fcm/send/abc"
	if w := do(h, req{method: "PUT", path: "/v1/push/subscription", origin: origin, body: subscription(endpoint)}); w.Code != 401 {
		t.Errorf("signed out: %d", w.Code)
	}
	if w := do(h, req{method: "PUT", path: "/v1/push/subscription", origin: origin, cookie: cookie, body: subscription(endpoint)}); w.Code != 204 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	subs, _ := db.Subscriptions(context.Background(), user42)
	if len(subs) != 1 || subs[0].Endpoint != endpoint || subs[0].P256dh != p256dh {
		t.Fatalf("stored %+v", subs)
	}

	w := do(h, req{method: "DELETE", path: "/v1/push/subscription", origin: origin, cookie: cookie, body: fmt.Sprintf(`{"endpoint":%q}`, endpoint)})
	if w.Code != 204 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if subs, _ := db.Subscriptions(context.Background(), user42); len(subs) != 0 {
		t.Errorf("still there: %+v", subs)
	}
}

func TestOnlyRealPushServices(t *testing.T) {
	h, _, cookie := setupPush(t)
	for endpoint, ok := range map[string]bool{
		"https://fcm.googleapis.com/fcm/send/x":                  true,
		"https://updates.push.services.mozilla.com/wpush/v2/x":   true,
		"https://web.push.apple.com/QGx":                         true,
		"https://wns2-par02p.notify.windows.com/w/?token=x":      true,
		"http://fcm.googleapis.com/fcm/send/x":                   false,
		"https://fcm.googleapis.com:8443/x":                      false,
		"https://evilfcm.googleapis.com.example.com/x":           false,
		"https://notfcm.googleapis.com.attacker.net/x":           false,
		"https://169.254.169.254/latest/meta-data":               false,
		"https://user:pass@fcm.googleapis.com/x":                 false,
		"https://example.com/?u=https://fcm.googleapis.com/send": false,
	} {
		w := do(h, req{method: "PUT", path: "/v1/push/subscription", origin: origin, cookie: cookie, body: subscription(endpoint)})
		if (w.Code == 204) != ok {
			t.Errorf("%s: %d %s", endpoint, w.Code, w.Body)
		}
	}
}

func TestSubscriptionKeysAreChecked(t *testing.T) {
	h, _, cookie := setupPush(t)
	body := `{"endpoint":"https://fcm.googleapis.com/x","keys":{"p256dh":"c2hvcnQ","auth":"` + auth + `"}}`
	if w := do(h, req{method: "PUT", path: "/v1/push/subscription", origin: origin, cookie: cookie, body: body}); w.Code != 400 {
		t.Errorf("short key: %d", w.Code)
	}
}

func TestReplaceReminders(t *testing.T) {
	h, db, cookie := setupPush(t)
	ms := time.Date(2026, 11, 20, 13, 0, 0, 0, time.UTC).UnixMilli()
	sealed := base64.StdEncoding.EncodeToString([]byte("sealed"))
	body := fmt.Sprintf(`{"reminders":[{"id":"t1@%d","fireAt":%d,"payload":%q},{"id":"old","fireAt":1,"payload":%q}]}`, ms, ms, sealed, sealed)
	if w := do(h, req{method: "PUT", path: "/v1/reminders", origin: origin, cookie: cookie, body: body}); w.Code != 204 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	due, _ := db.DueReminders(context.Background(), ms, 10)
	if len(due) != 1 || due[0].UserID != user42 || string(due[0].Payload) != "sealed" {
		t.Fatalf("stored %+v", due)
	}

	// An empty set clears them
	if w := do(h, req{method: "PUT", path: "/v1/reminders", origin: origin, cookie: cookie, body: `{"reminders":[]}`}); w.Code != 204 {
		t.Fatalf("%d", w.Code)
	}
	if due, _ := db.DueReminders(context.Background(), ms, 10); len(due) != 0 {
		t.Errorf("left %+v", due)
	}
}

func TestRemindersAreChecked(t *testing.T) {
	h, _, cookie := setupPush(t)
	big := base64.StdEncoding.EncodeToString(make([]byte, maxPayload+1))
	for name, body := range map[string]string{
		"no set":     `{}`,
		"no id":      `{"reminders":[{"fireAt":5,"payload":"eA=="}]}`,
		"no payload": `{"reminders":[{"id":"a","fireAt":5}]}`,
		"too big":    `{"reminders":[{"id":"a","fireAt":5,"payload":"` + big + `"}]}`,
		"not base64": `{"reminders":[{"id":"a","fireAt":5,"payload":"%%%"}]}`,
	} {
		if w := do(h, req{method: "PUT", path: "/v1/reminders", origin: origin, cookie: cookie, body: body}); w.Code != 400 {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
}

func TestPushEndpointsNeedAKey(t *testing.T) {
	h, _ := setup(t)
	if w := do(h, req{method: "GET", path: "/v1/push/key"}); w.Code != 404 {
		t.Errorf("%d", w.Code)
	}
}
