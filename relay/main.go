package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"doozly.app/relay/internal/api"
	"doozly.app/relay/internal/config"
	"doozly.app/relay/internal/google"
	"doozly.app/relay/internal/identity"
	"doozly.app/relay/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("relay stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	envFile := flag.String("env", "", "read KEY=VALUE settings from this file first, like systemd's EnvironmentFile")
	flag.Parse()
	if *envFile != "" {
		if err := config.ReadEnvFile(*envFile, os.LookupEnv, os.Setenv); err != nil {
			return err
		}
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// Lives until the process ends, go-oidc fetches the providers' keys with it
	keysCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()
	verifier := identity.New(keysCtx, identity.Options{
		GoogleClientID:    cfg.GoogleClientID,
		MicrosoftClientID: cfg.MicrosoftClientID,
	})

	var googleTokens api.GoogleTokens
	if cfg.GoogleClientSecret != "" {
		googleTokens = google.New(cfg.GoogleClientID, cfg.GoogleClientSecret)
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: api.New(api.Options{
			Store:          db,
			Verifier:       verifier,
			Google:         googleTokens,
			Sessions:       api.Sessions{Key: cfg.SessionKey, TTL: cfg.SessionTTL},
			AllowedOrigins: cfg.AllowedOrigins,
			TrustedProxies: cfg.TrustedProxies,
			Log:            log,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	failed := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr,
			"google", cfg.GoogleClientID != "", "googleTokens", googleTokens != nil,
			"microsoft", cfg.MicrosoftClientID != "")
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
	}()

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	// Let running requests finish, but don't hang a systemd restart for long
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
