#!/bin/sh
# Runs on the server as root, from deploy.sh. Safe to run again: each deploy does the same steps.
set -eu

src=$1
addr=127.0.0.1:8080

if [ ! -f /etc/doozly-relay/relay.env ]; then
	echo "/etc/doozly-relay/relay.env is missing, make it from relay.env.server.example first" >&2
	exit 1
fi
chown root:root /etc/doozly-relay/relay.env
chmod 0600 /etc/doozly-relay/relay.env
configured=$(sed -n 's/^RELAY_ADDR=//p' /etc/doozly-relay/relay.env | tail -n 1)
[ -n "$configured" ] && addr=$configured

if ! id -u doozly-relay >/dev/null 2>&1; then
	useradd --system --no-create-home --home-dir /var/lib/doozly-relay --shell /usr/sbin/nologin doozly-relay
fi

# A copy from just before the new binary, in case a migration goes wrong
if systemctl is-active --quiet doozly-relay; then
	systemctl start doozly-relay-backup.service
fi

if [ -f /usr/local/bin/doozly-relay ]; then
	cp -p /usr/local/bin/doozly-relay /usr/local/bin/doozly-relay.prev
fi
install -m 0755 "$src/doozly-relay" /usr/local/bin/doozly-relay.new
mv -f /usr/local/bin/doozly-relay.new /usr/local/bin/doozly-relay
for unit in doozly-relay.service doozly-relay-backup.service doozly-relay-backup.timer; do
	install -m 0644 "$src/$unit" /etc/systemd/system/$unit
done

systemctl daemon-reload
systemctl enable --quiet doozly-relay.service doozly-relay-backup.timer
systemctl restart doozly-relay.service
systemctl start doozly-relay-backup.timer

for _ in 1 2 3 4 5 6 7 8 9 10; do
	if curl -fs -o /dev/null "http://$addr/healthz"; then
		echo "relay is up on $addr"
		exit 0
	fi
	sleep 1
done

journalctl -u doozly-relay -n 30 --no-pager >&2 || true
echo "the relay didn't answer on /healthz. To go back: mv /usr/local/bin/doozly-relay.prev /usr/local/bin/doozly-relay && systemctl restart doozly-relay" >&2
exit 1
