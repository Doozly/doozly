package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupCopiesAndPrunes(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO reminders (user_id, reminder_id, fire_at, payload) VALUES ('u', 'r', 1, x'00')`); err != nil {
		t.Fatal(err)
	}
	var dbPath string
	s.DB.QueryRowContext(ctx, "SELECT file FROM pragma_database_list WHERE name = 'main'").Scan(&dbPath)

	dir := filepath.Join(t.TempDir(), "backups")
	start := time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC)
	var last string
	// The relay stays open meanwhile, like on the server
	for day := range 4 {
		path, err := Backup(ctx, dbPath, dir, 3, start.AddDate(0, 0, day))
		if err != nil {
			t.Fatal(err)
		}
		last = path
	}
	if filepath.Base(last) != "relay-20261123T030000Z.db" {
		t.Errorf("named %s", filepath.Base(last))
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 3 || entries[0].Name() != "relay-20261121T030000Z.db" {
		t.Errorf("kept %v", entries)
	}

	snap, err := Open(ctx, last)
	if err != nil {
		t.Fatal(err)
	}
	defer snap.Close()
	var rows int
	snap.DB.QueryRowContext(ctx, "SELECT count(*) FROM reminders").Scan(&rows)
	if rows != 1 {
		t.Errorf("the copy has %d reminders", rows)
	}
}

func TestBackupNeedsADatabase(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "relay.db")
	if _, err := Backup(context.Background(), missing, filepath.Join(dir, "b"), 3, time.Now()); err == nil {
		t.Error("a missing database should fail, not make an empty one")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Error("the backup made a database")
	}
}

func TestPruneLeavesOtherFiles(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"relay-1.db", "relay-2.db", "notes.txt", "relay-3.db.tmp"} {
		os.WriteFile(filepath.Join(dir, name), nil, 0o600)
	}
	if err := prune(dir, 1); err != nil {
		t.Fatal(err)
	}
	var names []string
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if len(names) != 3 || names[0] != "notes.txt" || names[1] != "relay-2.db" {
		t.Errorf("left %v", names)
	}
}
