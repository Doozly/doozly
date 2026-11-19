package store

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Each step takes the schema from version i to i+1. Only ever append.
// Nothing in here is precious: the clients can always send it all again.
var migrations = []string{
	`CREATE TABLE subscriptions (
		endpoint   TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL,
		p256dh     TEXT NOT NULL,
		auth       TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX subscriptions_user ON subscriptions (user_id);
	CREATE TABLE reminders (
		user_id     TEXT NOT NULL,
		reminder_id TEXT NOT NULL,
		fire_at     INTEGER NOT NULL,
		payload     BLOB NOT NULL,
		PRIMARY KEY (user_id, reminder_id)
	);
	CREATE INDEX reminders_due ON reminders (fire_at);`,
}

type Store struct {
	DB *sql.DB
}

// Open opens or creates the database and brings its schema up to date.
func Open(ctx context.Context, path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite writes one at a time anyway, one connection saves us from "database is locked"
	db.SetMaxOpenConns(1)
	s := &Store{DB: db}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.DB.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("the database is at schema %d, this relay knows up to %d", version, len(migrations))
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Ping(ctx context.Context) error {
	return s.DB.PingContext(ctx)
}

func (s *Store) Close() error {
	return s.DB.Close()
}
