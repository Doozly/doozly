//! Sign-in in the system browser: the OAuth code flow with PKCE, redirected to a one-off listener
//! on this machine. Refresh tokens stay in the OS keychain, the webview only gets access tokens.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, oneshot};
use url::Url;

// Personal Microsoft accounts all live in this tenant, like in src/sync/microsoft/auth.ts
const CONSUMER_TENANT: &str = "9188040d-6c67-4c5b-b112-36a304b66dad";
/// Enough for a password and a 2FA code. After that a closed tab frees the button again.
const WAIT: Duration = Duration::from_secs(180);
/// A token counts as gone a minute early, so no request sets off with one about to die
const MARGIN: Duration = Duration::from_secs(60);
const KEYCHAIN_SERVICE: &str = "app.doozly.desktop";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Google,
    Microsoft,
    Dropbox,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Google => "google",
            Kind::Microsoft => "microsoft",
            Kind::Dropbox => "dropbox",
        }
    }
}

/// What the webview gets back, mapped to SignInError, AuthError or ProviderError there
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AuthError {
    Cancelled,
    NoDriveAccess,
    SignedOut,
    Network(String),
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub email: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub work: Option<bool>,
}

/// Kept in the keychain per provider
#[derive(Clone, Serialize, Deserialize)]
pub struct Saved {
    refresh_token: String,
    profile: Profile,
}

pub struct Provider {
    kind: Kind,
    authorize: String,
    token: String,
    revoke: Option<String>,
    client_id: String,
    client_secret: Option<String>,
    scopes: &'static str,
    /// Sync can't work without this one
    storage_scope: &'static str,
    /// Entra matches "localhost" on any port, Google wants the loopback IP
    redirect_host: &'static str,
    /// Dropbox matches the redirect URI exactly, so it gets a few registered ports. Empty: any free one.
    ports: &'static [u16],
}

impl Provider {
    pub fn configured(kind: Kind) -> Option<Self> {
        Some(match kind {
            Kind::Microsoft => Self {
                kind,
                authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
                token: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
                revoke: None,
                client_id: option_env!("DOOZLY_VITE_MICROSOFT_CLIENT_ID")?.into(),
                client_secret: None,
                scopes: "Files.ReadWrite.AppFolder offline_access openid profile",
                storage_scope: "Files.ReadWrite.AppFolder",
                redirect_host: "localhost",
                ports: &[],
            },
            Kind::Google => Self {
                kind,
                authorize: "https://accounts.google.com/o/oauth2/v2/auth".into(),
                token: "https://oauth2.googleapis.com/token".into(),
                revoke: Some("https://oauth2.googleapis.com/revoke".into()),
                client_id: option_env!("DOOZLY_GOOGLE_DESKTOP_CLIENT_ID")?.into(),
                // Google says it plainly: for desktop apps this one isn't secret
                client_secret: option_env!("DOOZLY_GOOGLE_DESKTOP_CLIENT_SECRET").map(Into::into),
                scopes: "https://www.googleapis.com/auth/drive.appdata openid email profile",
                storage_scope: "https://www.googleapis.com/auth/drive.appdata",
                redirect_host: "127.0.0.1",
                ports: &[],
            },
            Kind::Dropbox => Self {
                kind,
                authorize: "https://www.dropbox.com/oauth2/authorize".into(),
                token: "https://api.dropboxapi.com/oauth2/token".into(),
                // Takes the access token and ends its refresh token with it, only this sign-in
                revoke: Some("https://api.dropboxapi.com/2/auth/token/revoke".into()),
                client_id: option_env!("DOOZLY_VITE_DROPBOX_CLIENT_ID")?.into(),
                // PKCE, no secret
                client_secret: None,
                scopes: "account_info.read files.metadata.read files.content.read files.content.write openid email profile",
                storage_scope: "files.content.write",
                redirect_host: "localhost",
                // Registered in the Dropbox app as http://localhost:<port>, see .env.example
                ports: &[38471, 38472, 38473],
            },
        })
    }
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("no system randomness");
    URL_SAFE_NO_PAD.encode(buf)
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    id_token: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

#[derive(Deserialize, Default)]
struct Claims {
    sub: Option<String>,
    oid: Option<String>,
    tid: Option<String>,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
}

/// The same ids as on the web: Google's sub, MSAL's home account id (oid.tid), Dropbox's account id
fn profile_from(kind: Kind, id_token: &str) -> Result<Profile, AuthError> {
    let bad = || AuthError::Failed("The sign-in answer had no usable ID token".into());
    // Straight from the token endpoint over TLS, so the payload is all we need, no signature check
    let payload = id_token.split('.').nth(1).ok_or_else(bad)?;
    let json = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| bad())?;
    let c: Claims = serde_json::from_slice(&json).map_err(|_| bad())?;
    let email = c.email.or(c.preferred_username).unwrap_or_default();
    // Dropbox has no name claim, only its parts
    let parts = [c.given_name, c.family_name]
        .into_iter()
        .flatten()
        .filter(|n| !n.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let name = c
        .name
        .filter(|n| !n.is_empty())
        .or(Some(parts).filter(|n| !n.is_empty()))
        .unwrap_or_else(|| email.clone());
    Ok(match kind {
        // Dropbox's sub is the account id, like get_current_account gives the web
        Kind::Google | Kind::Dropbox => Profile {
            id: c.sub.ok_or_else(bad)?,
            email,
            name,
            work: None,
        },
        Kind::Microsoft => {
            let (oid, tid) = (c.oid.ok_or_else(bad)?, c.tid.ok_or_else(bad)?);
            let work = Some(tid != CONSUMER_TENANT);
            Profile {
                id: format!("{oid}.{tid}"),
                email,
                name,
                work,
            }
        }
    })
}

/// Microsoft answers "Files.ReadWrite.AppFolder", sometimes with Graph's prefix in front
fn granted(scope: Option<&str>, wanted: &str) -> bool {
    let wanted = wanted.to_ascii_lowercase();
    scope.unwrap_or("").split(' ').any(|s| {
        let s = s.to_ascii_lowercase();
        s == wanted || s.ends_with(&format!("/{wanted}"))
    })
}

async fn post_token(
    http: &reqwest::Client,
    p: &Provider,
    form: &[(&str, &str)],
) -> Result<TokenResponse, AuthError> {
    let mut form = form.to_vec();
    form.push(("client_id", &p.client_id));
    if let Some(secret) = &p.client_secret {
        form.push(("client_secret", secret));
    }
    let res = http
        .post(&p.token)
        .form(&form)
        .send()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;
    let status = res.status();
    let body = res
        .bytes()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;
    if status.is_success() {
        return serde_json::from_slice(&body).map_err(|e| AuthError::Failed(e.to_string()));
    }
    match serde_json::from_slice::<TokenError>(&body) {
        Ok(e) if e.error == "invalid_grant" => Err(AuthError::SignedOut),
        Ok(e) => Err(AuthError::Failed(e.error_description.unwrap_or(e.error))),
        Err(_) => Err(AuthError::Failed(format!(
            "The token endpoint answered {status}"
        ))),
    }
}

/// Both loopbacks on one port: browsers may try ::1 first for "localhost". With fixed ports the first free one.
async fn listen(ports: &[u16]) -> std::io::Result<(TcpListener, Option<TcpListener>, u16)> {
    let mut last = None;
    for &port in if ports.is_empty() { &[0] } else { ports } {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(v4) => {
                let port = v4.local_addr()?.port();
                let v6 = TcpListener::bind(("::1", port)).await.ok();
                return Ok((v4, v6, port));
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.expect("tried at least one port"))
}

async fn accept(v4: &TcpListener, v6: Option<&TcpListener>) -> std::io::Result<TcpStream> {
    match v6 {
        Some(v6) => tokio::select! {
            r = v4.accept() => r.map(|(s, _)| s),
            r = v6.accept() => r.map(|(s, _)| s),
        },
        None => v4.accept().await.map(|(s, _)| s),
    }
}

/// The request line's target, from the head of a plain HTTP request
async fn read_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        if buf.len() > 8192 {
            return None;
        }
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next()?.split(' ');
    (parts.next()? == "GET").then(|| parts.next().map(str::to_string))?
}

async fn answer(stream: &mut TcpStream, status: &str, title: &str, text: &str) {
    let body = format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Doozly</title>\
         <body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem\">\
         <h1>{title}</h1><p>{text}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Waits for the provider to send the browser back with a code. Anything else is answered and ignored.
async fn wait_for_code(
    v4: &TcpListener,
    v6: Option<&TcpListener>,
    state: &str,
) -> Result<String, AuthError> {
    loop {
        let Ok(mut stream) = accept(v4, v6).await else {
            continue;
        };
        let Some(target) = read_target(&mut stream).await else {
            continue;
        };
        let Ok(url) = Url::parse(&format!("http://localhost{target}")) else {
            continue;
        };
        if url.path() != "/" {
            answer(&mut stream, "404 Not Found", "Not found", "").await;
            continue;
        }
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        if q.get("state").map(String::as_str) != Some(state) {
            // Not our sign-in, maybe an old tab. Keep waiting for the real one.
            answer(
                &mut stream,
                "400 Bad Request",
                "This sign-in has expired",
                "Start it again from Doozly.",
            )
            .await;
            continue;
        }
        if let Some(error) = q.get("error") {
            answer(
                &mut stream,
                "200 OK",
                "Sign-in stopped",
                "You can close this tab and go back to Doozly.",
            )
            .await;
            return Err(if error == "access_denied" {
                AuthError::Cancelled
            } else {
                AuthError::Failed(q.get("error_description").unwrap_or(error).clone())
            });
        }
        if let Some(code) = q.get("code") {
            answer(
                &mut stream,
                "200 OK",
                "Signed in to Doozly",
                "You can close this tab and go back to the app.",
            )
            .await;
            return Ok(code.clone());
        }
    }
}

/// The whole browser round: open the sign-in page, catch the code, swap it for tokens
async fn authorize(
    http: &reqwest::Client,
    p: &Provider,
    open: impl FnOnce(&Url) -> Result<(), String>,
    cancel: oneshot::Receiver<()>,
) -> Result<(Saved, TokenResponse), AuthError> {
    let (v4, v6, port) = listen(p.ports)
        .await
        .map_err(|e| AuthError::Failed(e.to_string()))?;
    let redirect = format!("http://{}:{port}", p.redirect_host);
    let verifier = random_b64(32);
    let state = random_b64(16);
    let mut url = Url::parse(&p.authorize).map_err(|e| AuthError::Failed(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("client_id", &p.client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", p.scopes)
        .append_pair("code_challenge", &challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    match p.kind {
        // Without both Google only sends a refresh token the very first time
        Kind::Google => url
            .query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent"),
        Kind::Microsoft => url
            .query_pairs_mut()
            .append_pair("prompt", "select_account"),
        Kind::Dropbox => url
            .query_pairs_mut()
            .append_pair("token_access_type", "offline"),
    };
    open(&url).map_err(AuthError::Failed)?;

    let code = tokio::select! {
        r = tokio::time::timeout(WAIT, wait_for_code(&v4, v6.as_ref(), &state)) => r.map_err(|_| AuthError::Cancelled)??,
        _ = cancel => return Err(AuthError::Cancelled),
    };
    drop((v4, v6));

    let tokens = post_token(
        http,
        p,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    if !granted(tokens.scope.as_deref(), p.storage_scope) {
        return Err(AuthError::NoDriveAccess);
    }
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| AuthError::Failed("The provider sent no refresh token".into()))?;
    let profile = profile_from(p.kind, tokens.id_token.as_deref().unwrap_or(""))?;
    Ok((
        Saved {
            refresh_token,
            profile,
        },
        tokens,
    ))
}

/// The keychain, and memory when there's none (a Linux without a running keyring)
pub trait Store: Send + Sync {
    fn get(&self, kind: Kind) -> Option<Saved>;
    /// false when it's only in memory, gone after a restart
    fn set(&self, kind: Kind, saved: &Saved) -> bool;
    fn remove(&self, kind: Kind);
}

#[derive(Default)]
pub struct Keychain {
    memory: StdMutex<HashMap<Kind, Saved>>,
}

impl Keychain {
    fn entry(kind: Kind) -> Option<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, kind.name()).ok()
    }
}

impl Store for Keychain {
    fn get(&self, kind: Kind) -> Option<Saved> {
        if let Some(saved) = self.memory.lock().unwrap().get(&kind) {
            return Some(saved.clone());
        }
        let json = Self::entry(kind)?.get_password().ok()?;
        serde_json::from_str(&json).ok()
    }

    fn set(&self, kind: Kind, saved: &Saved) -> bool {
        let json = serde_json::to_string(saved).expect("Saved always serialises");
        let kept = Self::entry(kind).is_some_and(|e| e.set_password(&json).is_ok());
        let mut memory = self.memory.lock().unwrap();
        if kept {
            memory.remove(&kind);
        } else {
            memory.insert(kind, saved.clone());
        }
        kept
    }

    fn remove(&self, kind: Kind) {
        self.memory.lock().unwrap().remove(&kind);
        if let Some(e) = Self::entry(kind) {
            let _ = e.delete_credential();
        }
    }
}

struct Cached {
    token: String,
    until: Instant,
}

pub struct Auth {
    http: reqwest::Client,
    store: Arc<dyn Store>,
    cache: Mutex<HashMap<Kind, Cached>>,
    /// A new sign-in stops the one still waiting for its browser tab
    waiting: StdMutex<Option<oneshot::Sender<()>>>,
}

impl Auth {
    pub fn new(store: Arc<dyn Store>) -> Self {
        // reqwest has no crypto of its own here, the updater does the same
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self {
            http,
            store,
            cache: Mutex::default(),
            waiting: StdMutex::default(),
        }
    }

    // The keychain blocks (D-Bus on Linux), so never on the async threads
    async fn load(&self, kind: Kind) -> Option<Saved> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.get(kind))
            .await
            .ok()
            .flatten()
    }

    async fn save(&self, kind: Kind, saved: Saved) -> bool {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.set(kind, &saved))
            .await
            .unwrap_or(false)
    }

    async fn forget(&self, kind: Kind) {
        let store = self.store.clone();
        let _ = tokio::task::spawn_blocking(move || store.remove(kind)).await;
    }

    async fn sign_in_with(
        &self,
        p: &Provider,
        open: impl FnOnce(&Url) -> Result<(), String>,
    ) -> Result<Profile, AuthError> {
        let (stop, cancel) = oneshot::channel();
        if let Some(old) = self.waiting.lock().unwrap().replace(stop) {
            let _ = old.send(());
        }
        let (saved, tokens) = authorize(&self.http, p, open, cancel).await?;
        let profile = saved.profile.clone();
        if !self.save(p.kind, saved).await {
            eprintln!(
                "doozly: no keychain, the {} sign-in lasts until Doozly quits",
                p.kind.name()
            );
        }
        self.keep(p.kind, &tokens).await;
        Ok(profile)
    }

    async fn keep(&self, kind: Kind, t: &TokenResponse) -> String {
        let until = Instant::now() + Duration::from_secs(t.expires_in).saturating_sub(MARGIN);
        self.cache.lock().await.insert(
            kind,
            Cached {
                token: t.access_token.clone(),
                until,
            },
        );
        t.access_token.clone()
    }

    /// From the cache, or refreshed with the keychain's refresh token. One refresh at a time.
    async fn token_with(&self, p: &Provider) -> Result<String, AuthError> {
        let mut cache = self.cache.lock().await;
        if let Some(c) = cache.get(&p.kind).filter(|c| Instant::now() < c.until) {
            return Ok(c.token.clone());
        }
        let saved = self.load(p.kind).await.ok_or(AuthError::SignedOut)?;
        let mut form = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", saved.refresh_token.as_str()),
        ];
        if p.kind == Kind::Microsoft {
            form.push(("scope", p.scopes));
        }
        let tokens = match post_token(&self.http, p, &form).await {
            Err(AuthError::SignedOut) => {
                self.forget(p.kind).await;
                return Err(AuthError::SignedOut);
            }
            other => other?,
        };
        // Microsoft hands out a new refresh token each time
        if let Some(next) = tokens
            .refresh_token
            .clone()
            .filter(|r| *r != saved.refresh_token)
        {
            self.save(
                p.kind,
                Saved {
                    refresh_token: next,
                    profile: saved.profile,
                },
            )
            .await;
        }
        let until = Instant::now() + Duration::from_secs(tokens.expires_in).saturating_sub(MARGIN);
        cache.insert(
            p.kind,
            Cached {
                token: tokens.access_token.clone(),
                until,
            },
        );
        Ok(tokens.access_token)
    }

    async fn sign_out_with(&self, p: &Provider) {
        // Dropbox revokes with an access token, so get one while the refresh token is still here
        let bearer = match p.kind {
            Kind::Dropbox => self.token_with(p).await.ok(),
            _ => None,
        };
        self.cache.lock().await.remove(&p.kind);
        let saved = self.load(p.kind).await;
        self.forget(p.kind).await;
        let (Some(url), Some(saved)) = (&p.revoke, saved) else {
            return;
        };
        let request = match bearer {
            Some(bearer) => self.http.post(url).bearer_auth(bearer),
            None if p.kind == Kind::Dropbox => return,
            None => self.http.post(url).form(&[("token", saved.refresh_token)]),
        };
        let _ = request.send().await;
    }
}

fn provider(kind: Kind) -> Result<Provider, AuthError> {
    Provider::configured(kind).ok_or_else(|| {
        AuthError::Failed(format!("This build has no {} sign-in set up", kind.name()))
    })
}

#[tauri::command]
pub async fn sign_in(
    app: AppHandle,
    auth: State<'_, Auth>,
    provider: Kind,
) -> Result<Profile, AuthError> {
    let p = self::provider(provider)?;
    auth.sign_in_with(&p, |url| {
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn access_token(auth: State<'_, Auth>, provider: Kind) -> Result<String, AuthError> {
    auth.token_with(&self::provider(provider)?).await
}

/// The provider refused the token, so the next call gets a fresh one
#[tauri::command]
pub async fn drop_access_token(auth: State<'_, Auth>, provider: Kind) -> Result<(), ()> {
    auth.cache.lock().await.remove(&provider);
    Ok(())
}

/// The account from an earlier run, without asking the provider
#[tauri::command]
pub async fn restored_account(
    auth: State<'_, Auth>,
    provider: Kind,
) -> Result<Option<Profile>, ()> {
    Ok(auth.load(provider).await.map(|s| s.profile))
}

#[tauri::command]
pub async fn sign_out(auth: State<'_, Auth>, provider: Kind) -> Result<(), AuthError> {
    auth.sign_out_with(&self::provider(provider)?).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Memory(StdMutex<HashMap<Kind, Saved>>);

    impl Store for Memory {
        fn get(&self, kind: Kind) -> Option<Saved> {
            self.0.lock().unwrap().get(&kind).cloned()
        }
        fn set(&self, kind: Kind, saved: &Saved) -> bool {
            self.0.lock().unwrap().insert(kind, saved.clone());
            true
        }
        fn remove(&self, kind: Kind) {
            self.0.lock().unwrap().remove(&kind);
        }
    }

    fn id_token(claims: serde_json::Value) -> String {
        format!("x.{}.y", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    /// A token endpoint that answers each POST with the next canned reply, and hands back the forms it got
    async fn fake_token_server(
        replies: Vec<(u16, serde_json::Value)>,
    ) -> (
        String,
        tokio::sync::mpsc::UnboundedReceiver<HashMap<String, String>>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!(
            "http://127.0.0.1:{}/token",
            listener.local_addr().unwrap().port()
        );
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (status, body) in replies {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let n = s.read(&mut chunk).await.unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len: usize = text
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse().unwrap())
                            })
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            let form = url::form_urlencoded::parse(&buf[end + 4..end + 4 + len])
                                .into_owned()
                                .collect();
                            let _ = tx.send(form);
                            break;
                        }
                    }
                }
                let body = body.to_string();
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                s.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        (url, rx)
    }

    fn test_provider(kind: Kind, token: String) -> Provider {
        Provider {
            kind,
            authorize: "https://example.com/authorize".into(),
            token,
            revoke: None,
            client_id: "client".into(),
            client_secret: (kind == Kind::Google).then(|| "not-secret".into()),
            scopes: if kind == Kind::Google {
                "https://www.googleapis.com/auth/drive.appdata openid"
            } else {
                "Files.ReadWrite.AppFolder offline_access"
            },
            storage_scope: if kind == Kind::Google {
                "https://www.googleapis.com/auth/drive.appdata"
            } else {
                "Files.ReadWrite.AppFolder"
            },
            redirect_host: if kind == Kind::Google {
                "127.0.0.1"
            } else {
                "localhost"
            },
            ports: &[],
        }
    }

    /// Plays the browser: follows the redirect back to the listener, with what the provider would add
    type Sent = oneshot::Receiver<HashMap<String, String>>;

    fn browser(
        extra: impl Fn(&HashMap<String, String>) -> String + Send + 'static,
    ) -> (impl FnOnce(&Url) -> Result<(), String>, Sent) {
        let (tx, rx) = oneshot::channel();
        let open = move |url: &Url| {
            let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
            let back = format!(
                "{}/?{}",
                q["redirect_uri"].replace("localhost", "127.0.0.1"),
                extra(&q)
            );
            tokio::spawn(async move {
                let _ = reqwest::get(&back).await;
            });
            // Some tests don't look at what was sent
            let _ = tx.send(q);
            Ok(())
        };
        (open, rx)
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn profiles_get_the_same_ids_as_on_the_web() {
        let ms = id_token(
            serde_json::json!({"oid": "o1", "tid": CONSUMER_TENANT, "preferred_username": "sam@outlook.com", "name": "Sam"}),
        );
        assert_eq!(
            profile_from(Kind::Microsoft, &ms).unwrap(),
            Profile {
                id: format!("o1.{CONSUMER_TENANT}"),
                email: "sam@outlook.com".into(),
                name: "Sam".into(),
                work: Some(false)
            }
        );
        let work = id_token(
            serde_json::json!({"oid": "o2", "tid": "contoso", "preferred_username": "sam@contoso.com"}),
        );
        assert_eq!(
            profile_from(Kind::Microsoft, &work).unwrap().work,
            Some(true)
        );
        assert_eq!(
            profile_from(Kind::Microsoft, &work).unwrap().name,
            "sam@contoso.com"
        );
        let g =
            id_token(serde_json::json!({"sub": "123", "email": "sam@example.com", "name": "Sam"}));
        assert_eq!(profile_from(Kind::Google, &g).unwrap().id, "123");
        assert!(profile_from(Kind::Google, "garbage").is_err());
        let d = id_token(
            serde_json::json!({"sub": "dbid:AAH4", "email": "sam@example.com", "given_name": "Sam", "family_name": "Lee"}),
        );
        assert_eq!(
            profile_from(Kind::Dropbox, &d).unwrap(),
            Profile {
                id: "dbid:AAH4".into(),
                email: "sam@example.com".into(),
                name: "Sam Lee".into(),
                work: None
            }
        );
    }

    #[test]
    fn the_storage_scope_has_to_be_granted() {
        assert!(granted(
            Some("openid Files.ReadWrite.AppFolder"),
            "Files.ReadWrite.AppFolder"
        ));
        assert!(granted(
            Some("https://graph.microsoft.com/files.readwrite.appfolder"),
            "Files.ReadWrite.AppFolder"
        ));
        assert!(!granted(
            Some("openid profile"),
            "Files.ReadWrite.AppFolder"
        ));
        assert!(!granted(
            None,
            "https://www.googleapis.com/auth/drive.appdata"
        ));
    }

    #[tokio::test]
    async fn fixed_ports_go_to_the_next_one_when_taken() {
        let taken = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let busy = taken.local_addr().unwrap().port();
        let free = {
            let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            l.local_addr().unwrap().port()
        };
        let (_, _, port) = listen(&[busy, free]).await.unwrap();
        assert_eq!(port, free);
        assert!(listen(&[busy]).await.is_err());
        assert_ne!(listen(&[]).await.unwrap().2, 0);
    }

    #[tokio::test]
    async fn signs_in_through_the_browser_and_keeps_the_refresh_token() {
        let id =
            id_token(serde_json::json!({"sub": "g1", "email": "sam@example.com", "name": "Sam"}));
        let (token_url, mut forms) = fake_token_server(vec![(
            200,
            serde_json::json!({
                "access_token": "at1", "expires_in": 3600, "refresh_token": "rt1", "id_token": id,
                "scope": "https://www.googleapis.com/auth/drive.appdata openid",
            }),
        )])
        .await;
        let p = test_provider(Kind::Google, token_url);
        let auth = Auth::new(Arc::new(Memory::default()));
        let (open, sent) = browser(|q| format!("code=c1&state={}", q["state"]));

        let profile = auth.sign_in_with(&p, open).await.unwrap();
        assert_eq!(profile.id, "g1");
        let sent = sent.await.unwrap();
        assert_eq!(sent["code_challenge_method"], "S256");
        assert!(sent["redirect_uri"].starts_with("http://127.0.0.1:"));
        assert_eq!(sent["access_type"], "offline");

        let form = forms.recv().await.unwrap();
        assert_eq!(form["code"], "c1");
        assert_eq!(form["client_secret"], "not-secret");
        // The verifier we send now is the one the challenge in the browser was made from
        assert_eq!(challenge(&form["code_verifier"]), sent["code_challenge"]);
        assert_eq!(form["redirect_uri"], sent["redirect_uri"]);

        assert_eq!(auth.store.get(Kind::Google).unwrap().refresh_token, "rt1");
        assert_eq!(auth.token_with(&p).await.unwrap(), "at1");
    }

    #[tokio::test]
    async fn a_wrong_state_is_ignored_and_a_refusal_counts_as_cancelled() {
        let auth = Auth::new(Arc::new(Memory::default()));
        let p = test_provider(Kind::Microsoft, "http://127.0.0.1:9/token".into());
        // A stray favicon request and a code with someone else's state: both get answered, neither ends it
        let (open, _) = browser(|q| {
            let port = q["redirect_uri"].rsplit(':').next().unwrap().to_string();
            tokio::spawn(async move {
                let _ = reqwest::get(format!("http://127.0.0.1:{port}/favicon.ico")).await;
            });
            "code=evil&state=wrong".to_string()
        });
        let (stop, cancel) = oneshot::channel();
        let attempt =
            tokio::spawn(async move { authorize(&auth.http, &p, open, cancel).await.map(|_| ()) });
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            !attempt.is_finished(),
            "a wrong state must not end the sign-in"
        );
        stop.send(()).unwrap();
        assert_eq!(attempt.await.unwrap(), Err(AuthError::Cancelled));

        let auth = Auth::new(Arc::new(Memory::default()));
        let p = test_provider(Kind::Microsoft, "http://127.0.0.1:9/token".into());
        let (open, sent) = browser(|q| format!("error=access_denied&state={}", q["state"]));
        assert_eq!(auth.sign_in_with(&p, open).await, Err(AuthError::Cancelled));
        assert_eq!(sent.await.unwrap()["prompt"], "select_account");
    }

    #[tokio::test]
    async fn no_storage_access_means_no_sign_in() {
        let id = id_token(serde_json::json!({"oid": "o", "tid": "t"}));
        let (token_url, _) = fake_token_server(vec![(200, serde_json::json!({
            "access_token": "at", "expires_in": 3600, "refresh_token": "rt", "id_token": id, "scope": "openid profile",
        }))]).await;
        let auth = Auth::new(Arc::new(Memory::default()));
        let p = test_provider(Kind::Microsoft, token_url);
        let (open, _) = browser(|q| format!("code=c&state={}", q["state"]));
        assert_eq!(
            auth.sign_in_with(&p, open).await,
            Err(AuthError::NoDriveAccess)
        );
        assert!(auth.store.get(Kind::Microsoft).is_none());
    }

    #[tokio::test]
    async fn refreshing_keeps_the_new_refresh_token_and_a_revoked_one_signs_out() {
        let (token_url, mut forms) = fake_token_server(vec![
            (200, serde_json::json!({"access_token": "at2", "expires_in": 3600, "refresh_token": "rt2"})),
            (400, serde_json::json!({"error": "invalid_grant", "error_description": "revoked"})),
        ]).await;
        let p = test_provider(Kind::Microsoft, token_url);
        let store = Memory::default();
        let profile = Profile {
            id: "o.t".into(),
            email: "sam@contoso.com".into(),
            name: "Sam".into(),
            work: Some(true),
        };
        store.set(
            Kind::Microsoft,
            &Saved {
                refresh_token: "rt1".into(),
                profile,
            },
        );
        let auth = Auth::new(Arc::new(store));

        assert_eq!(auth.token_with(&p).await.unwrap(), "at2");
        let form = forms.recv().await.unwrap();
        assert_eq!(form["refresh_token"], "rt1");
        assert_eq!(form["scope"], p.scopes);
        assert_eq!(
            auth.store.get(Kind::Microsoft).unwrap().refresh_token,
            "rt2"
        );
        // Cached now, no second request
        assert_eq!(auth.token_with(&p).await.unwrap(), "at2");

        auth.cache.lock().await.clear();
        assert_eq!(auth.token_with(&p).await, Err(AuthError::SignedOut));
        assert!(auth.store.get(Kind::Microsoft).is_none());
    }
}
