package google

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
var ErrInvalidGrant = errors.New("google: invalid grant")

type Tokens struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
}

// Client talks to Google's token endpoint with our client secret. That secret is
// the one reason this relay exists for Google, it can't live in the browser.
type Client struct {
	ClientID     string
	ClientSecret string
	// GIS's popup code flow has no real redirect, Google wants "postmessage" here
	RedirectURI string
	TokenURL    string
	HTTP        *http.Client
}

func New(clientID, clientSecret string) *Client {
	return &Client{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  "postmessage",
		TokenURL:     "https://oauth2.googleapis.com/token",
		HTTP:         &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) Exchange(ctx context.Context, code string) (Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {c.RedirectURI},
	})
}

// Refresh gets a new access token. Google usually sends no new refresh token, the old one stays good.
func (c *Client) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	})
}

func (c *Client) token(ctx context.Context, form url.Values) (Tokens, error) {
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	res, err := c.post(ctx, c.TokenURL, form)
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
		return Tokens{}, fmt.Errorf("google token endpoint: %d %s %s", res.StatusCode, e.Error, e.Description)
	}
	var t Tokens
	if err := json.Unmarshal(body, &t); err != nil {
		return Tokens{}, err
	}
	if t.AccessToken == "" {
		return Tokens{}, errors.New("google token endpoint: no access token")
	}
	return t, nil
}

func (c *Client) post(ctx context.Context, endpoint string, form url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.HTTP.Do(req)
}
