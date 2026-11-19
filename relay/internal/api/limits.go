package api

import (
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// clientIP is the peer's address, or Cloudflare's CF-Connecting-IP when the peer is a
// proxy we trust (cloudflared on loopback). Anyone else could just make that header up.
func clientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	peer = peer.Unmap()
	for _, p := range trusted {
		if p.Contains(peer) {
			if cf, err := netip.ParseAddr(r.Header.Get("CF-Connecting-IP")); err == nil {
				return cf.Unmap()
			}
			break
		}
	}
	return peer
}

// limiter is a token bucket per key (an IP or a user). Idle buckets get dropped.
type limiter struct {
	mu      sync.Mutex
	every   rate.Limit
	burst   int
	buckets map[string]*bucket
	now     func() time.Time
	swept   time.Time
}

type bucket struct {
	*rate.Limiter
	seen time.Time
}

func newLimiter(perSecond float64, burst int, now func() time.Time) *limiter {
	return &limiter{
		every:   rate.Limit(perSecond),
		burst:   burst,
		buckets: map[string]*bucket{},
		now:     now,
		swept:   now(),
	}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.swept) > time.Minute {
		// A full bucket idle this long is the same as a new one, so it can go
		for k, b := range l.buckets {
			if now.Sub(b.seen) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
		l.swept = now
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{Limiter: rate.NewLimiter(l.every, l.burst)}
		l.buckets[key] = b
	}
	b.seen = now
	return b.AllowN(now, 1)
}
