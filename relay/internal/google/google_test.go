package google

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Google's token endpoint, as much as we use of it
func fakeGoogle(t *testing.T) (*Client, *[]map[string]string) {
	t.Helper()
	var seen []map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		form := map[string]string{"path": r.URL.Path}
		for k := range r.PostForm {
			form[k] = r.PostForm.Get(k)
		}
		seen = append(seen, form)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case form["client_secret"] != "secret":
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_client"})
		case form["code"] == "good" || form["refresh_token"] == "rt":
			json.NewEncoder(w).Encode(Tokens{AccessToken: "at", ExpiresIn: 3599, RefreshToken: "rt", IDToken: "idt", Scope: "a b"})
		default:
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant", "error_description": "Bad Request"})
		}
	}))
	t.Cleanup(srv.Close)
	c := New("client", "secret")
	c.TokenURL = srv.URL + "/token"
	return c, &seen
}

func TestExchangeAndRefresh(t *testing.T) {
	c, seen := fakeGoogle(t)
	ctx := context.Background()
	tokens, err := c.Exchange(ctx, "good")
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken != "at" || tokens.RefreshToken != "rt" || tokens.IDToken != "idt" || tokens.ExpiresIn != 3599 {
		t.Errorf("%+v", tokens)
	}
	form := (*seen)[0]
	if form["grant_type"] != "authorization_code" || form["redirect_uri"] != "postmessage" || form["client_id"] != "client" {
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
	c, _ := fakeGoogle(t)
	if _, err := c.Refresh(context.Background(), "revoked"); !errors.Is(err, ErrInvalidGrant) {
		t.Errorf("got %v", err)
	}
	c.ClientSecret = "wrong"
	_, err := c.Exchange(context.Background(), "good")
	if err == nil || errors.Is(err, ErrInvalidGrant) {
		t.Errorf("a wrong secret is our problem, not the user's: %v", err)
	}
}
