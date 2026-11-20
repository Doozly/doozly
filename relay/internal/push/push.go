package push

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"doozly.app/relay/internal/store"
)

// Sender delivers one push. The status is the push service's answer.
type Sender interface {
	Send(ctx context.Context, sub store.Subscription, body []byte, ttl time.Duration) (status int, err error)
}

// VAPID sends through the browsers' push services, signed with our key pair.
type VAPID struct {
	PublicKey  string
	PrivateKey string
	// An email address or an https URL, so the push services know who to write when something's off
	Subject string
	Client  *http.Client
}

func (v VAPID) Send(ctx context.Context, sub store.Subscription, body []byte, ttl time.Duration) (int, error) {
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	res, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      client,
		Subscriber:      strings.TrimPrefix(v.Subject, "mailto:"),
		VAPIDPublicKey:  v.PublicKey,
		VAPIDPrivateKey: v.PrivateKey,
		TTL:             int(ttl.Seconds()),
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 4<<10))
	return res.StatusCode, nil
}

// Message is what the service worker gets. The payload stays as the client encrypted it.
type Message struct {
	ID      string `json:"id"`
	Payload string `json:"payload"`
}

type Store interface {
	DueReminders(ctx context.Context, upTo int64, limit int) ([]store.Reminder, error)
	DeleteReminder(ctx context.Context, r store.Reminder) error
	Subscriptions(ctx context.Context, userID string) ([]store.Subscription, error)
	DropEndpoint(ctx context.Context, endpoint string) error
}

// Loop sends reminders when they come due.
type Loop struct {
	Store  Store
	Sender Sender
	// Later than this, a reminder is dropped instead of sent. Covers a restart or a short outage.
	Grace    time.Duration
	Interval time.Duration
	Now      func() time.Time
	Log      *slog.Logger
}

// Run ticks until the context ends.
func (l *Loop) Run(ctx context.Context) {
	ticker := time.NewTicker(l.Interval)
	defer ticker.Stop()
	for {
		if err := l.Tick(ctx); err != nil && ctx.Err() == nil {
			l.Log.Error("push loop", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Tick sends everything due now. A reminder whose push failed for a passing reason
// stays for the next tick, until it's older than the grace window.
func (l *Loop) Tick(ctx context.Context) error {
	now := l.Now()
	due, err := l.Store.DueReminders(ctx, now.UnixMilli(), 500)
	if err != nil {
		return err
	}
	subs := map[string][]store.Subscription{}
	for _, r := range due {
		late := now.Sub(time.UnixMilli(r.FireAt))
		if late > l.Grace {
			l.Log.Info("reminder dropped, too late", "late", late.Round(time.Second).String())
			if err := l.Store.DeleteReminder(ctx, r); err != nil {
				return err
			}
			continue
		}
		if _, ok := subs[r.UserID]; !ok {
			if subs[r.UserID], err = l.Store.Subscriptions(ctx, r.UserID); err != nil {
				return err
			}
		}
		body, _ := json.Marshal(Message{ID: r.ID, Payload: base64.StdEncoding.EncodeToString(r.Payload)})
		retry := false
		for _, sub := range subs[r.UserID] {
			retry = l.send(ctx, sub, body, l.Grace-late) || retry
		}
		if retry {
			continue
		}
		if err := l.Store.DeleteReminder(ctx, r); err != nil {
			return err
		}
	}
	return nil
}

// send says whether it's worth trying again later
func (l *Loop) send(ctx context.Context, sub store.Subscription, body []byte, ttl time.Duration) bool {
	status, err := l.Sender.Send(ctx, sub, body, ttl)
	switch {
	case err != nil:
		l.Log.Warn("push failed", "err", err)
		return true
	case status == http.StatusNotFound || status == http.StatusGone:
		// The browser unsubscribed or the subscription expired, it won't come back
		if err := l.Store.DropEndpoint(ctx, sub.Endpoint); err != nil {
			l.Log.Error("dropping subscription", "err", err)
		}
		return false
	case status == http.StatusTooManyRequests || status >= 500:
		l.Log.Warn("push service busy", "status", status)
		return true
	case status >= 400:
		l.Log.Warn("push refused", "status", status)
		return false
	}
	return false
}
