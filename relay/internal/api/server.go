package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/netip"
	"slices"
	"time"

	"doozly.app/relay/internal/identity"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type Options struct {
	Store    Pinger
	Verifier identity.Verifier
	Sessions Sessions
	// nil when there's no Google client secret, then the Google endpoints aren't there
	Google GoogleTokens
	// nil when there's no Dropbox client ID, the same
	Dropbox DropboxTokens
	// Both or neither. Without a VAPID key there's no push, and its endpoints aren't there.
	Push           PushStore
	VAPIDPublicKey string
	AllowedOrigins []string
	TrustedProxies []netip.Prefix
	Log            *slog.Logger
	Now            func() time.Time
}

type server struct {
	Options
	perIP   *limiter
	perUser *limiter
	sealer  *sealer
	dropbox *sealer
}

type ctxKey int

const userKey ctxKey = 0

// New builds the whole HTTP API, middleware included.
func New(o Options) http.Handler {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Sessions.Now == nil {
		o.Sessions.Now = o.Now
	}
	s := &server{
		Options: o,
		// Generous for people, tight for scripts: a tab syncs reminders a few times a minute at most
		perIP:   newLimiter(5, 30, o.Now),
		perUser: newLimiter(1, 20, o.Now),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("POST /v1/session", s.createSession)
	mux.HandleFunc("DELETE /v1/session", s.deleteSession)
	mux.Handle("GET /v1/session", s.signedIn(http.HandlerFunc(s.getSession)))
	if o.Google != nil {
		sealer, err := newGoogleSealer(o.Sessions.Key)
		if err != nil {
			panic(err)
		}
		s.sealer = sealer
		mux.HandleFunc("POST /v1/auth/google/token", s.googleToken)
		mux.HandleFunc("POST /v1/auth/google/refresh", s.googleRefresh)
		mux.HandleFunc("DELETE /v1/auth/google", s.googleSignOut)
	}
	if o.Dropbox != nil {
		sealer, err := newDropboxSealer(o.Sessions.Key)
		if err != nil {
			panic(err)
		}
		s.dropbox = sealer
		mux.HandleFunc("POST /v1/auth/dropbox/token", s.dropboxToken)
		mux.HandleFunc("POST /v1/auth/dropbox/refresh", s.dropboxRefresh)
		mux.HandleFunc("DELETE /v1/auth/dropbox", s.dropboxSignOut)
	}
	if o.Push != nil && o.VAPIDPublicKey != "" {
		mux.HandleFunc("GET /v1/push/key", s.pushKey)
		mux.Handle("PUT /v1/push/subscription", s.signedIn(http.HandlerFunc(s.putSubscription)))
		mux.Handle("DELETE /v1/push/subscription", s.signedIn(http.HandlerFunc(s.deleteSubscription)))
		mux.Handle("PUT /v1/reminders", s.signedIn(http.HandlerFunc(s.putReminders)))
	}

	return s.recover(s.logRequests(s.limitIPs(s.cors(mux))))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.Store.Ping(ctx); err != nil {
		s.Log.Error("health check: database", "err", err)
		fail(w, http.StatusServiceUnavailable, "database")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /v1/session {"provider": "google"|"microsoft"|"dropbox", "idToken": "..."} swaps a provider's ID token for our cookie
func (s *server) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string `json:"provider"`
		IDToken  string `json:"idToken"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IDToken == "" {
		fail(w, http.StatusBadRequest, "bad_request")
		return
	}
	id, err := s.Verifier.Verify(r.Context(), body.Provider, body.IDToken)
	switch {
	case errors.Is(err, identity.ErrUnknownProvider):
		fail(w, http.StatusBadRequest, "unknown_provider")
		return
	case err != nil:
		s.Log.Info("ID token refused", "provider", body.Provider, "err", err)
		fail(w, http.StatusUnauthorized, "invalid_token")
		return
	}
	if !s.perUser.allow(id.UserID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	s.Sessions.Issue(w, id.UserID)
	writeJSON(w, http.StatusOK, map[string]string{"userId": id.UserID})
}

func (s *server) getSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"userId": r.Context().Value(userKey).(string)})
}

func (s *server) deleteSession(w http.ResponseWriter, r *http.Request) {
	s.Sessions.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}

// signedIn lets only requests with a valid session through, each user within their own rate limit.
func (s *server) signedIn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := s.Sessions.User(r)
		if user == "" {
			fail(w, http.StatusUnauthorized, "signed_out")
			return
		}
		if !s.perUser.allow(user) {
			fail(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, user)))
	})
}

// cors lets the SPA's origins in with cookies. Anything that changes state must come from one
// of them, which together with SameSite=Strict keeps other sites from making requests as the user.
func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := origin != "" && slices.Contains(s.AllowedOrigins, origin)
		w.Header().Add("Vary", "Origin")
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			if !allowed {
				fail(w, http.StatusForbidden, "origin")
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !allowed {
			fail(w, http.StatusForbidden, "origin")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) limitIPs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The uptime check mustn't get locked out
		if r.URL.Path != "/healthz" && !s.perIP.allow(clientIP(r, s.TrustedProxies).String()) {
			w.Header().Set("Retry-After", "10")
			fail(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// logRequests logs method, path, status and time. No IPs, cookies or bodies.
func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := s.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		level := slog.LevelInfo
		if r.URL.Path == "/healthz" && rec.status == http.StatusOK {
			level = slog.LevelDebug
		}
		s.Log.Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"ms", s.Now().Sub(start).Milliseconds(),
		)
	})
}

func (s *server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.Log.Error("panic", "path", r.URL.Path, "panic", v)
				fail(w, http.StatusInternalServerError, "internal")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
