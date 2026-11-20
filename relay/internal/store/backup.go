package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupPrefix, backupSuffix = "relay-", ".db"

// Backup writes a consistent copy of the database at dbPath into dir, while the relay keeps running,
// and then keeps only the newest keep copies. It gives the new file's path.
func Backup(ctx context.Context, dbPath, dir string, keep int, now time.Time) (string, error) {
	// sql.Open would happily make an empty database, which is no backup of anything
	if _, err := os.Stat(dbPath); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return "", err
	}
	defer db.Close()

	dest := filepath.Join(dir, backupPrefix+now.UTC().Format("20060102T150405Z")+backupSuffix)
	tmp := dest + ".tmp"
	os.Remove(tmp)
	// VACUUM INTO gives a snapshot like sqlite3's .backup, without needing the CLI on the server
	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", tmp); err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("backup: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return dest, prune(dir, keep)
}

func prune(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var backups []string
	for _, e := range entries {
		name := e.Name()
		if e.Type().IsRegular() && strings.HasPrefix(name, backupPrefix) && strings.HasSuffix(name, backupSuffix) {
			backups = append(backups, name)
		}
	}
	// The names hold the UTC time, so sorting them sorts by age
	sort.Strings(backups)
	for len(backups) > keep {
		if err := os.Remove(filepath.Join(dir, backups[0])); err != nil {
			return err
		}
		backups = backups[1:]
	}
	return nil
}
