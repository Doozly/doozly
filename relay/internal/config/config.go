package config

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strings"
	"time"
)

// Config comes from the environment. On the server systemd fills it from an env file.
type Config struct {
	Addr           string
	DBPath         string
	SessionKey     []byte
	SessionTTL     time.Duration
	AllowedOrigins []string
	TrustedProxies []netip.Prefix
	GoogleClientID string
	// Only on the server, never in the SPA. Without it the Google token endpoints are off.
	GoogleClientSecret string
	MicrosoftClientID  string
	LogLevel           slog.Level
}

// Load reads the RELAY_* and provider variables. Only the session key is a must.
func Load(getenv func(string) string) (Config, error) {
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	cfg := Config{
		Addr:               get("RELAY_ADDR", "127.0.0.1:8080"),
		DBPath:             get("RELAY_DB", "relay.db"),
		SessionTTL:         30 * 24 * time.Hour,
		AllowedOrigins:     list(get("RELAY_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")),
		GoogleClientID:     get("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: get("GOOGLE_CLIENT_SECRET", ""),
		MicrosoftClientID:  get("MICROSOFT_CLIENT_ID", ""),
	}

	key, err := base64.StdEncoding.DecodeString(get("RELAY_SESSION_KEY", ""))
	if err != nil {
		return cfg, fmt.Errorf("RELAY_SESSION_KEY isn't base64: %w", err)
	}
	if len(key) < 32 {
		return cfg, errors.New("RELAY_SESSION_KEY needs at least 32 random bytes, base64 encoded (openssl rand -base64 32)")
	}
	cfg.SessionKey = key

	if ttl := get("RELAY_SESSION_TTL", ""); ttl != "" {
		if cfg.SessionTTL, err = time.ParseDuration(ttl); err != nil {
			return cfg, fmt.Errorf("RELAY_SESSION_TTL: %w", err)
		}
	}

	// The tunnel's cloudflared talks to us over loopback, so by default only that is trusted
	for _, p := range list(get("RELAY_TRUSTED_PROXIES", "127.0.0.1/32,::1/128")) {
		prefix, err := netip.ParsePrefix(p)
		if err != nil {
			return cfg, fmt.Errorf("RELAY_TRUSTED_PROXIES: %w", err)
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
	}

	if cfg.GoogleClientSecret != "" && cfg.GoogleClientID == "" {
		return cfg, errors.New("GOOGLE_CLIENT_SECRET without GOOGLE_CLIENT_ID")
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(get("RELAY_LOG_LEVEL", "info"))); err != nil {
		return cfg, fmt.Errorf("RELAY_LOG_LEVEL: %w", err)
	}
	return cfg, nil
}

func list(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// ReadEnvFile sets KEY=VALUE lines from a file, for running it locally like systemd would.
// Variables already set win, so a one-off override on the command line still works.
func ReadEnvFile(path string, lookup func(string) (string, bool), set func(k, v string) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for n := 1; scanner.Scan(); n++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s:%d: no = in the line", path, n)
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := lookup(key); exists {
			continue
		}
		if err := set(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}
