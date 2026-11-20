package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"doozly.app/relay/internal/api"
	"doozly.app/relay/internal/config"
	"doozly.app/relay/internal/google"
	"doozly.app/relay/internal/identity"
	"doozly.app/relay/internal/push"
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
	vapidKeys := flag.Bool("vapid-keys", false, "print a fresh VAPID key pair for the env file and exit")
	backupDir := flag.String("backup", "", "write a copy of RELAY_DB into this folder and exit, the relay may keep running")
	keep := flag.Int("keep", 14, "with -backup: how many copies to keep")
	flag.Parse()
	if *vapidKeys {
		private, public, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return err
		}
		fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", public, private)
		return nil
	}
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
	if *backupDir != "" {
		path, err := store.Backup(context.Background(), cfg.DBPath, *backupDir, max(*keep, 1), time.Now())
		if err != nil {
			return err
		}
		log.Info("backed up", "path", path)
		return nil
	}

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

	var pushStore api.PushStore
	if cfg.VAPIDPublicKey != "" {
		pushStore = db
		loop := &push.Loop{
			Store: db,
			Sender: push.VAPID{
				PublicKey:  cfg.VAPIDPublicKey,
				PrivateKey: cfg.VAPIDPrivateKey,
				Subject:    cfg.VAPIDSubject,
			},
			// A reminder over an hour late helps nobody, and a restart is done well before that
			Grace:    time.Hour,
			Interval: 10 * time.Second,
			Now:      time.Now,
			Log:      log,
		}
		go loop.Run(ctx)
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: api.New(api.Options{
			Store:          db,
			Verifier:       verifier,
			Google:         googleTokens,
			Push:           pushStore,
			VAPIDPublicKey: cfg.VAPIDPublicKey,
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
			"microsoft", cfg.MicrosoftClientID != "", "push", pushStore != nil)
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
