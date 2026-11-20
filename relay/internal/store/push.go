package store

import (
	"context"
	"time"
)

// Subscription is one browser's web push subscription.
type Subscription struct {
	Endpoint string
	UserID   string
	P256dh   string
	Auth     string
}

// Reminder is one push to send at FireAt. The payload is encrypted on the client, we can't read it.
type Reminder struct {
	UserID  string
	ID      string
	FireAt  int64 // epoch ms
	Payload []byte
}

// PutSubscription adds a device, or moves it to another user when the endpoint is known already.
func (s *Store) PutSubscription(ctx context.Context, sub Subscription, now time.Time) error {
	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO subscriptions (endpoint, user_id, p256dh, auth, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (endpoint) DO UPDATE SET
			user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
		sub.Endpoint, sub.UserID, sub.P256dh, sub.Auth, now.Unix())
	return err
}

// DeleteSubscription removes a device, but only the user's own.
func (s *Store) DeleteSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM subscriptions WHERE user_id = ? AND endpoint = ?`, userID, endpoint)
	return err
}

// DropEndpoint forgets a subscription the push service says is gone.
func (s *Store) DropEndpoint(ctx context.Context, endpoint string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

func (s *Store) Subscriptions(ctx context.Context, userID string) ([]Subscription, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT endpoint, p256dh, auth FROM subscriptions WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Subscription
	for rows.Next() {
		sub := Subscription{UserID: userID}
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// ReplaceReminders swaps the user's whole set for this one. Times already gone are left out,
// so sending the same set again never repeats a push that went out already.
func (s *Store) ReplaceReminders(ctx context.Context, userID string, rs []Reminder, now time.Time) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM reminders WHERE user_id = ?`, userID); err != nil {
		return err
	}
	insert, err := tx.PrepareContext(ctx,
		`INSERT OR REPLACE INTO reminders (user_id, reminder_id, fire_at, payload) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insert.Close()
	for _, r := range rs {
		if r.FireAt <= now.UnixMilli() {
			continue
		}
		if _, err := insert.ExecContext(ctx, userID, r.ID, r.FireAt, r.Payload); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DueReminders gives up to limit reminders with FireAt at or before upTo, oldest first.
func (s *Store) DueReminders(ctx context.Context, upTo int64, limit int) ([]Reminder, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT user_id, reminder_id, fire_at, payload FROM reminders
		WHERE fire_at <= ? ORDER BY fire_at LIMIT ?`, upTo, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reminder
	for rows.Next() {
		var r Reminder
		if err := rows.Scan(&r.UserID, &r.ID, &r.FireAt, &r.Payload); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteReminder removes a sent reminder, unless the client has put it back with another time meanwhile.
func (s *Store) DeleteReminder(ctx context.Context, r Reminder) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM reminders WHERE user_id = ? AND reminder_id = ? AND fire_at = ?`,
		r.UserID, r.ID, r.FireAt)
	return err
}
