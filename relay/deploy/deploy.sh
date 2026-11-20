#!/bin/sh
# Builds the relay and installs it on the server: relay/deploy/deploy.sh user@host [arm64|amd64]
set -eu

if [ $# -lt 1 ]; then
	echo "usage: $0 user@host [arm64|amd64]" >&2
	exit 2
fi
host=$1
arch=${2:-arm64}
here=$(cd "$(dirname "$0")" && pwd)

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# No CGO, the SQLite driver is pure Go, so one static binary for any Linux
(cd "$here/.." && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$out/doozly-relay" .)
cp "$here/install.sh" "$here/doozly-relay.service" "$here/doozly-relay-backup.service" "$here/doozly-relay-backup.timer" "$out/"

remote=$(ssh "$host" mktemp -d)
scp -q "$out"/* "$host:$remote/"
# shellcheck disable=SC2029 # $remote is meant to expand here
ssh "$host" "sudo sh $remote/install.sh $remote; status=\$?; rm -rf $remote; exit \$status"
