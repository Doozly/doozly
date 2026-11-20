package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"doozly.app/relay/internal/store"
)

// fakeSender answers per endpoint with a status, or a network error for status 0
type fakeSender struct {
	status map[string]int
	sent   []string
}

func (f *fakeSender) Send(_ context.Context, sub store.Subscription, body []byte, _ time.Duration) (int, error) {
	f.sent = append(f.sent, sub.Endpoint+" "+string(body))
	status, ok := f.status[sub.Endpoint]
	if !ok {
		return http.StatusCreated, nil
	}
	if status == 0 {
		return 0, errors.New("connection refused")
	}
	return status, nil
}

func setup(t *testing.T, sender Sender) (*Loop, *store.Store, *time.Time) {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "relay.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	now := time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)
	loop := &Loop{
		Store:    s,
		Sender:   sender,
		Grace:    time.Hour,
		Interval: time.Second,
		Now:      func() time.Time { return now },
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return loop, s, &now
}

func subscribe(t *testing.T, s *store.Store, user string, endpoints ...string) {
	t.Helper()
	for _, e := range endpoints {
		if err := s.PutSubscription(context.Background(),
			store.Subscription{Endpoint: e, UserID: user, P256dh: "k", Auth: "a"}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
}

func remind(t *testing.T, s *store.Store, user string, now time.Time, rs ...store.Reminder) {
	t.Helper()
	if err := s.ReplaceReminders(context.Background(), user, rs, now); err != nil {
		t.Fatal(err)
	}
}

func remaining(t *testing.T, s *store.Store) int {
	t.Helper()
	due, err := s.DueReminders(context.Background(), 1<<62, 100)
	if err != nil {
		t.Fatal(err)
	}
	return len(due)
}

func TestSendsDueRemindersToEveryDevice(t *testing.T) {
	sender := &fakeSender{}
	loop, s, now := setup(t, sender)
	subscribe(t, s, "u1", "https://push/phone", "https://push/laptop")
	at := now.Add(time.Minute).UnixMilli()
	remind(t, s, "u1", *now,
		store.Reminder{ID: "r1", FireAt: at, Payload: []byte("sealed")},
		store.Reminder{ID: "r2", FireAt: now.Add(time.Hour).UnixMilli(), Payload: []byte("x")})

	loop.Tick(context.Background())
	if len(sender.sent) != 0 {
		t.Fatalf("sent too early: %v", sender.sent)
	}

	*now = now.Add(time.Minute)
	loop.Tick(context.Background())
	want := `{"id":"r1","payload":"` + base64.StdEncoding.EncodeToString([]byte("sealed")) + `"}`
	if len(sender.sent) != 2 || sender.sent[0] != "https://push/phone "+want ||
		!strings.HasPrefix(sender.sent[1], "https://push/laptop ") {
		t.Fatalf("sent %v", sender.sent)
	}
	if remaining(t, s) != 1 {
		t.Error("a sent reminder should be gone")
	}
}

func TestGoneSubscriptionsArePruned(t *testing.T) {
	sender := &fakeSender{status: map[string]int{"https://push/old": http.StatusGone, "https://push/lost": http.StatusNotFound}}
	loop, s, now := setup(t, sender)
	subscribe(t, s, "u1", "https://push/old", "https://push/lost", "https://push/ok")
	remind(t, s, "u1", *now, store.Reminder{ID: "r", FireAt: now.Add(time.Second).UnixMilli(), Payload: []byte("x")})
	*now = now.Add(time.Second)
	loop.Tick(context.Background())

	subs, _ := s.Subscriptions(context.Background(), "u1")
	if len(subs) != 1 || subs[0].Endpoint != "https://push/ok" {
		t.Errorf("left %+v", subs)
	}
	if remaining(t, s) != 0 {
		t.Error("reminder should be done")
	}
}

func TestBusyPushServiceIsTriedAgainWithinGrace(t *testing.T) {
	sender := &fakeSender{status: map[string]int{"https://push/a": http.StatusServiceUnavailable}}
	loop, s, now := setup(t, sender)
	subscribe(t, s, "u1", "https://push/a")
	remind(t, s, "u1", *now, store.Reminder{ID: "r", FireAt: now.Add(time.Second).UnixMilli(), Payload: []byte("x")})

	*now = now.Add(time.Second)
	loop.Tick(context.Background())
	if remaining(t, s) != 1 {
		t.Fatal("a 503 should keep it for another go")
	}

	delete(sender.status, "https://push/a")
	*now = now.Add(time.Minute)
	loop.Tick(context.Background())
	if len(sender.sent) != 2 || remaining(t, s) != 0 {
		t.Errorf("sent %d times, %d left", len(sender.sent), remaining(t, s))
	}
}

func TestNetworkErrorsGiveUpAfterGrace(t *testing.T) {
	sender := &fakeSender{status: map[string]int{"https://push/a": 0}}
	loop, s, now := setup(t, sender)
	subscribe(t, s, "u1", "https://push/a")
	remind(t, s, "u1", *now, store.Reminder{ID: "r", FireAt: now.Add(time.Second).UnixMilli(), Payload: []byte("x")})

	*now = now.Add(time.Second)
	loop.Tick(context.Background())
	*now = now.Add(2 * time.Hour)
	loop.Tick(context.Background())
	if len(sender.sent) != 1 || remaining(t, s) != 0 {
		t.Errorf("sent %d times, %d left", len(sender.sent), remaining(t, s))
	}
}

func TestCatchUpAfterARestart(t *testing.T) {
	sender := &fakeSender{}
	loop, s, now := setup(t, sender)
	subscribe(t, s, "u1", "https://push/a")
	remind(t, s, "u1", *now,
		store.Reminder{ID: "missed-a-bit", FireAt: now.Add(time.Minute).UnixMilli(), Payload: []byte("x")},
		store.Reminder{ID: "missed-a-lot", FireAt: now.Add(time.Second).UnixMilli(), Payload: []byte("x")})

	// The relay was down from just after now until 61 minutes later
	*now = now.Add(61 * time.Minute)
	loop.Tick(context.Background())
	if len(sender.sent) != 1 || !strings.Contains(sender.sent[0], "missed-a-bit") {
		t.Errorf("sent %v", sender.sent)
	}
	if remaining(t, s) != 0 {
		t.Error("both should be gone")
	}
}

func TestVAPIDSendsAnEncryptedSignedPush(t *testing.T) {
	var got *http.Request
	var body []byte
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer service.Close()

	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	// A browser's subscription keys
	browser, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	rand.Read(auth)
	sub := store.Subscription{
		Endpoint: service.URL + "/send/abc",
		P256dh:   base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}

	v := VAPID{PublicKey: public, PrivateKey: private, Subject: "mailto:hello@doozly.app"}
	status, err := v.Send(context.Background(), sub, []byte(`{"id":"r"}`), 30*time.Minute)
	if err != nil || status != http.StatusCreated {
		t.Fatalf("status %d, err %v", status, err)
	}
	if got.URL.Path != "/send/abc" || got.Header.Get("TTL") != "1800" ||
		got.Header.Get("Urgency") != "high" || got.Header.Get("Content-Encoding") != "aes128gcm" {
		t.Errorf("headers %v", got.Header)
	}
	if !strings.HasPrefix(got.Header.Get("Authorization"), "vapid t=") ||
		!strings.Contains(got.Header.Get("Authorization"), "k="+public) {
		t.Errorf("authorization %q", got.Header.Get("Authorization"))
	}
	if strings.Contains(string(body), `"id"`) {
		t.Error("the body went out in clear")
	}
}
