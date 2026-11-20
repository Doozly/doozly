package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "relay.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSubscriptions(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	now := time.Unix(1000, 0)
	a := Subscription{Endpoint: "https://push/a", UserID: "u1", P256dh: "k", Auth: "a"}
	b := Subscription{Endpoint: "https://push/b", UserID: "u1", P256dh: "k", Auth: "a"}
	for _, sub := range []Subscription{a, b} {
		if err := s.PutSubscription(ctx, sub, now); err != nil {
			t.Fatal(err)
		}
	}

	// The same browser signing in as someone else moves over to them
	a.UserID = "u2"
	s.PutSubscription(ctx, a, now)
	if subs, _ := s.Subscriptions(ctx, "u1"); len(subs) != 1 || subs[0].Endpoint != b.Endpoint {
		t.Errorf("u1 has %+v", subs)
	}

	// Someone else can't remove it, its own user can
	s.DeleteSubscription(ctx, "u1", a.Endpoint)
	if subs, _ := s.Subscriptions(ctx, "u2"); len(subs) != 1 {
		t.Error("another user removed u2's subscription")
	}
	s.DeleteSubscription(ctx, "u2", a.Endpoint)
	s.DropEndpoint(ctx, b.Endpoint)
	for _, u := range []string{"u1", "u2"} {
		if subs, _ := s.Subscriptions(ctx, u); len(subs) != 0 {
			t.Errorf("%s still has %+v", u, subs)
		}
	}
}

func TestReminders(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	now := time.UnixMilli(10_000)
	set := []Reminder{
		{ID: "past", FireAt: 9_000, Payload: []byte{1}},
		{ID: "soon", FireAt: 11_000, Payload: []byte{2}},
		{ID: "later", FireAt: 20_000, Payload: []byte{3}},
	}
	if err := s.ReplaceReminders(ctx, "u1", set, now); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceReminders(ctx, "u2", []Reminder{{ID: "theirs", FireAt: 12_000, Payload: []byte{4}}}, now); err != nil {
		t.Fatal(err)
	}

	due, _ := s.DueReminders(ctx, 15_000, 10)
	if len(due) != 2 || due[0].ID != "soon" || due[1].ID != "theirs" || due[0].Payload[0] != 2 {
		t.Fatalf("due %+v", due)
	}

	// A new set replaces the old one completely
	s.ReplaceReminders(ctx, "u1", set[2:], now)
	due, _ = s.DueReminders(ctx, 15_000, 10)
	if len(due) != 1 || due[0].ID != "theirs" {
		t.Errorf("due after replace %+v", due)
	}

	// Moved to another time meanwhile, then the old send doesn't delete it
	moved := set[2]
	moved.FireAt = 30_000
	s.ReplaceReminders(ctx, "u1", []Reminder{moved}, now)
	s.DeleteReminder(ctx, set[2])
	if due, _ := s.DueReminders(ctx, 40_000, 10); len(due) != 2 {
		t.Errorf("a stale delete removed the moved reminder: %+v", due)
	}
	s.DeleteReminder(ctx, Reminder{UserID: "u1", ID: "later", FireAt: 30_000})
	if due, _ := s.DueReminders(ctx, 40_000, 10); len(due) != 1 {
		t.Errorf("delete didn't: %+v", due)
	}
}
