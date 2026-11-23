package dropbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrInvalidGrant means the code or refresh token is no good any more: revoked, expired or used
var ErrInvalidGrant = errors.New("dropbox: invalid grant")

type Tokens struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
}

// Client talks to Dropbox's token endpoint. The browser does PKCE, so no client secret is needed.
// The relay is here to keep the refresh token out of the browser, not for a secret.
type Client struct {
	ClientID string
	TokenURL string
	HTTP     *http.Client
}

func New(clientID string) *Client {
	return &Client{
		ClientID: clientID,
		TokenURL: "https://api.dropboxapi.com/oauth2/token",
		HTTP:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Exchange swaps the popup's code for tokens. The redirect URI must be the same one the popup used.
func (c *Client) Exchange(ctx context.Context, code, verifier, redirectURI string) (Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
	})
}

// Refresh gets a new access token. Dropbox never sends a new refresh token or an ID token with it.
func (c *Client) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	})
}

func (c *Client) token(ctx context.Context, form url.Values) (Tokens, error) {
	form.Set("client_id", c.ClientID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Tokens{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return Tokens{}, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return Tokens{}, err
	}
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		json.Unmarshal(body, &e)
		if e.Error == "invalid_grant" {
			return Tokens{}, fmt.Errorf("%w: %s", ErrInvalidGrant, e.Description)
		}
		return Tokens{}, fmt.Errorf("dropbox token endpoint: %d %s %s", res.StatusCode, e.Error, e.Description)
	}
	var t Tokens
	if err := json.Unmarshal(body, &t); err != nil {
		return Tokens{}, err
	}
	if t.AccessToken == "" {
		return Tokens{}, errors.New("dropbox token endpoint: no access token")
	}
	return t, nil
}
