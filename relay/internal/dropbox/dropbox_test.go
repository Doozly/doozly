package dropbox

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Dropbox's token endpoint, as much as we use of it
func fakeDropbox(t *testing.T) (*Client, *[]map[string]string) {
	t.Helper()
	var seen []map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		form := map[string]string{}
		for k := range r.PostForm {
			form[k] = r.PostForm.Get(k)
		}
		seen = append(seen, form)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case form["client_id"] != "app-key":
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_client"})
		case form["code"] == "good" && form["code_verifier"] == "v" || form["refresh_token"] == "rt":
			json.NewEncoder(w).Encode(Tokens{AccessToken: "at", ExpiresIn: 14400, RefreshToken: "rt", IDToken: "idt", Scope: "a b"})
		default:
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant", "error_description": "code doesn't exist or has expired"})
		}
	}))
	t.Cleanup(srv.Close)
	c := New("app-key")
	c.TokenURL = srv.URL
	return c, &seen
}

func TestExchangeAndRefresh(t *testing.T) {
	c, seen := fakeDropbox(t)
	ctx := context.Background()
	tokens, err := c.Exchange(ctx, "good", "v", "https://doozly.app/redirect.html")
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken != "at" || tokens.RefreshToken != "rt" || tokens.IDToken != "idt" || tokens.ExpiresIn != 14400 {
		t.Errorf("%+v", tokens)
	}
	form := (*seen)[0]
	if form["grant_type"] != "authorization_code" || form["redirect_uri"] != "https://doozly.app/redirect.html" ||
		form["client_secret"] != "" {
		t.Errorf("exchange sent %v", form)
	}

	if _, err := c.Refresh(ctx, "rt"); err != nil {
		t.Fatal(err)
	}
	if (*seen)[1]["grant_type"] != "refresh_token" {
		t.Errorf("refresh sent %v", (*seen)[1])
	}
}

func TestInvalidGrantIsItsOwnError(t *testing.T) {
	c, _ := fakeDropbox(t)
	if _, err := c.Refresh(context.Background(), "revoked"); !errors.Is(err, ErrInvalidGrant) {
		t.Errorf("got %v", err)
	}
	if _, err := c.Exchange(context.Background(), "good", "wrong", "x"); !errors.Is(err, ErrInvalidGrant) {
		t.Errorf("a wrong verifier: %v", err)
	}
	c.ClientID = "other"
	_, err := c.Exchange(context.Background(), "good", "v", "x")
	if err == nil || errors.Is(err, ErrInvalidGrant) {
		t.Errorf("a wrong client is our problem, not the user's: %v", err)
	}
}
