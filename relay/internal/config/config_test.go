package config

import (
	"log/slog"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const key = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=" // 32 bytes

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	cfg, err := Load(env(map[string]string{"RELAY_SESSION_KEY": key}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:8080" || cfg.DBPath != "relay.db" {
		t.Errorf("addr %q db %q", cfg.Addr, cfg.DBPath)
	}
	if cfg.SessionTTL != 30*24*time.Hour || cfg.LogLevel != slog.LevelInfo {
		t.Errorf("ttl %v level %v", cfg.SessionTTL, cfg.LogLevel)
	}
	if len(cfg.TrustedProxies) != 2 || !cfg.TrustedProxies[0].Contains(netip.MustParseAddr("127.0.0.1")) {
		t.Errorf("trusted %v", cfg.TrustedProxies)
	}
	if strings.Join(cfg.AllowedOrigins, " ") != "http://localhost:5173 http://localhost:4173" {
		t.Errorf("origins %v", cfg.AllowedOrigins)
	}
}

func TestEverythingSet(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"RELAY_SESSION_KEY":     key,
		"RELAY_ADDR":            ":9000",
		"RELAY_ALLOWED_ORIGINS": " https://doozly.app , ",
		"RELAY_TRUSTED_PROXIES": "10.0.0.0/8",
		"RELAY_SESSION_TTL":     "2h",
		"RELAY_LOG_LEVEL":       "debug",
		"GOOGLE_CLIENT_ID":      "g",
		"GOOGLE_CLIENT_SECRET":  "s",
		"MICROSOFT_CLIENT_ID":   "m",
		"DROPBOX_CLIENT_ID":     "d",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":9000" || len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "https://doozly.app" {
		t.Errorf("%+v", cfg)
	}
	if cfg.SessionTTL != 2*time.Hour || cfg.LogLevel != slog.LevelDebug {
		t.Errorf("ttl %v level %v", cfg.SessionTTL, cfg.LogLevel)
	}
	if cfg.GoogleClientID != "g" || cfg.GoogleClientSecret != "s" || cfg.MicrosoftClientID != "m" || cfg.DropboxClientID != "d" {
		t.Errorf("client ids %q %q %q", cfg.GoogleClientID, cfg.MicrosoftClientID, cfg.DropboxClientID)
	}
}

func TestBadValues(t *testing.T) {
	for name, m := range map[string]map[string]string{
		"no key":        {},
		"short key":     {"RELAY_SESSION_KEY": "c2hvcnQ="},
		"not base64":    {"RELAY_SESSION_KEY": "!!"},
		"bad proxy":     {"RELAY_SESSION_KEY": key, "RELAY_TRUSTED_PROXIES": "nope"},
		"bad ttl":       {"RELAY_SESSION_KEY": key, "RELAY_SESSION_TTL": "soon"},
		"bad log level": {"RELAY_SESSION_KEY": key, "RELAY_LOG_LEVEL": "loud"},
		"secret, no id": {"RELAY_SESSION_KEY": key, "GOOGLE_CLIENT_SECRET": "s"},
	} {
		if _, err := Load(env(m)); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestReadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.env")
	content := "# comment\n\nRELAY_ADDR = :1234\nGOOGLE_CLIENT_ID=\"quoted\"\nRELAY_DB=from-file\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{"RELAY_DB": "already-set"}
	lookup := func(k string) (string, bool) { v, ok := got[k]; return v, ok }
	set := func(k, v string) error { got[k] = v; return nil }
	if err := ReadEnvFile(path, lookup, set); err != nil {
		t.Fatal(err)
	}
	if got["RELAY_ADDR"] != ":1234" || got["GOOGLE_CLIENT_ID"] != "quoted" || got["RELAY_DB"] != "already-set" {
		t.Errorf("%v", got)
	}

	if err := os.WriteFile(path, []byte("JUNK\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ReadEnvFile(path, lookup, set); err == nil {
		t.Error("a line without = should fail")
	}
}

func TestVAPID(t *testing.T) {
	base := map[string]string{"RELAY_SESSION_KEY": key}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	if _, err := Load(env(with(map[string]string{"VAPID_PUBLIC_KEY": "pub"}))); err == nil {
		t.Error("half a key pair should fail")
	}
	if _, err := Load(env(with(map[string]string{"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv"}))); err == nil {
		t.Error("no subject should fail")
	}
	cfg, err := Load(env(with(map[string]string{
		"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv", "VAPID_SUBJECT": "mailto:hello@doozly.app",
	})))
	if err != nil || cfg.VAPIDPublicKey != "pub" || cfg.VAPIDSubject != "mailto:hello@doozly.app" {
		t.Errorf("%+v %v", cfg, err)
	}
}
