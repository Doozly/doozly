package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenMigratesAndReopens(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "relay.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO reminders (user_id, reminder_id, fire_at, payload) VALUES ('u', 'r', 1, x'00')`); err != nil {
		t.Fatal(err)
	}
	s.Close()

	// A second start doesn't run the migrations again
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var version, rows int
	s.DB.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version)
	s.DB.QueryRowContext(ctx, "SELECT count(*) FROM reminders").Scan(&rows)
	if version != len(migrations) || rows != 1 {
		t.Errorf("version %d, rows %d", version, rows)
	}
}

func TestRefusesANewerSchema(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "relay.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	s.DB.ExecContext(ctx, "PRAGMA user_version = 99")
	s.Close()
	if _, err := Open(ctx, path); err == nil {
		t.Error("a newer schema should stop the relay")
	}
}
