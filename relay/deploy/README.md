# Deploying the relay

The relay runs as a systemd service on a small Linux VPS (Oracle Cloud Always Free). Cloudflare Tunnel connects it to `api.doozly.app`, so the server opens no inbound ports apart from SSH. Everything the relay stores can be rebuilt by the clients, so a lost server costs a few minutes of closed-app reminders, not data.

| File                                    | Goes to                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `doozly-relay.service`                  | `/etc/systemd/system/`, runs `/usr/local/bin/doozly-relay` as the `doozly-relay` user, database in `/var/lib/doozly-relay` |
| `doozly-relay-backup.service`, `.timer` | `/etc/systemd/system/`, daily copy into `/var/lib/doozly-relay/backups`, keeps 14                                          |
| `relay.env.server.example`              | `/etc/doozly-relay/relay.env` (root, 0600), the secrets                                                                    |
| `cloudflared.yml`                       | `/etc/cloudflared/config.yml`                                                                                              |
| `install.sh`                            | Run on the server by `deploy.sh`, never by hand                                                                            |

`deploy.sh` installs the units and the binary; the tunnel and the env file are set up once by hand.

## One-time server setup

1. **Create the instance.** Ubuntu 24.04. Ampere A1 (arm64, `VM.Standard.A1.Flex`, 1 OCPU and 6 GB is plenty) if the region has capacity, otherwise `VM.Standard.E2.1.Micro` (amd64). Add your SSH key. The relay needs well under 100 MB of memory.
2. **Idle reclamation.** Oracle may stop an Always Free instance whose 95th-percentile CPU, network and (on A1) memory use stay under 20 % for 7 days, which this relay will. Upgrading the account to Pay As You Go is reported to stop this while staying free within the Always Free limits. Check Oracle's current terms before relying on it.
3. **Firewall.** In the subnet's security list, allow only SSH (22) inbound, ideally from your own IP. The tunnel needs outbound traffic only.
4. **Install cloudflared** from Cloudflare's repository:

   ```sh
   sudo mkdir -p --mode=0755 /usr/share/keyrings
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt-get update && sudo apt-get install -y cloudflared
   ```

5. **Create the tunnel** (needs `doozly.app` on Cloudflare):

   ```sh
   cloudflared tunnel login                 # open the printed URL, pick doozly.app
   cloudflared tunnel create doozly-relay   # prints the tunnel id
   cloudflared tunnel route dns doozly-relay api.doozly.app
   sudo mkdir -p /etc/cloudflared
   sudo mv ~/.cloudflared/<tunnel id>.json /etc/cloudflared/
   ```

   Copy `cloudflared.yml` to `/etc/cloudflared/config.yml` and put the tunnel id in both places.

6. **Write the env file.** Copy `relay.env.server.example` to `/etc/doozly-relay/relay.env` and fill it in: a new `RELAY_SESSION_KEY` (`openssl rand -base64 32`), the Google, Microsoft and Dropbox client IDs, the Google client secret, a VAPID pair (`go run . -vapid-keys` in `relay/`) and a `VAPID_SUBJECT`. `install.sh` makes it root-only.
7. **Deploy** (below), then start the tunnel with `sudo cloudflared service install`. It starts at once, so doing it before the relay runs only gets you 502s. Check `curl https://api.doozly.app/healthz` from your own machine.

## Deploying

From the repository root, on a machine with Go:

```sh
relay/deploy/deploy.sh ubuntu@<server> arm64   # or amd64
```

It builds a static binary, copies it and the units over, backs up the database if the relay is running, swaps the binary (the old one stays as `doozly-relay.prev`), restarts the service and waits for `/healthz`. Running it again is safe.

**Rolling back:** `sudo mv /usr/local/bin/doozly-relay.prev /usr/local/bin/doozly-relay && sudo systemctl restart doozly-relay`. A relay refuses a database with a newer schema than it knows, so after a migration restore the backup taken before the deploy as well.

## Backups

The timer copies the database every day at about 03:30 UTC into `/var/lib/doozly-relay/backups` and keeps the newest 14 (`doozly-relay -backup`, a consistent snapshot taken while the relay runs). Run one by hand with `sudo systemctl start doozly-relay-backup`. The copies stay on the server on purpose: the database only caches what the clients send, so losing the server with its backups costs nothing that can't come back.

**Restoring:**

```sh
sudo systemctl stop doozly-relay
sudo -u doozly-relay cp /var/lib/doozly-relay/backups/relay-<time>.db /var/lib/doozly-relay/relay.db
sudo rm -f /var/lib/doozly-relay/relay.db-wal /var/lib/doozly-relay/relay.db-shm
sudo systemctl start doozly-relay
```

## Watching it

- **Uptime:** point an external monitor (any free uptime service) at `https://api.doozly.app/healthz` every 5 minutes, alerting by email. It answers 200 when the relay and its database are fine. A check from outside covers the server, the tunnel and Cloudflare at once.
- **Logs:** `journalctl -u doozly-relay -f` (JSON, no IPs, cookies or bodies). `journalctl -u cloudflared` for the tunnel.
- **Status:** `systemctl status doozly-relay cloudflared` and `systemctl list-timers doozly-relay-backup.timer`.
