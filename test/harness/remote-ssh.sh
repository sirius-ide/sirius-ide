#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# The remote server through a real remote extension (hole 12), end to end in a built app: an Ubuntu
# sshd container is the host (a fresh key, generated here), Open Remote - SSH from Open VSX is
# installed into the probe's extensions directory, and the probe opens the host's home folder in
# a new window — the extension downloads the release's server tarball onto the host, starts it and
# connects. Prints the probe's JSON, the server's own listing and log on the host, and takes a
# screenshot of the remote window (<result>.png) once the probe reports the connection.
#
# The extension uses proposed APIs (`resolvers`); Sirius lets an installed extension use the
# proposals it declares, so no product.json entry or --enable-proposed-api is needed.
#
#   test/harness/remote-ssh.sh <app-dir> [result.json]
#
# SIRIUS_PROBE_VSIX=<file> uses that VSIX instead of downloading the latest from Open VSX.

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.12-remote/VSCode-linux-x64}
OUT=$(realpath -m "${2:-$(mktemp --suffix=.json)}")
HERE=$(cd "$(dirname "$0")" && pwd)
CONTAINER=${SIRIUS_CONTAINER:-podman}
NAME=sirius-sshd-probe
PORT=${SIRIUS_PROBE_SSH_PORT:-2222}
HOST=sirius-probe
WORK=$(mktemp -d)

cleanup() {
	kill "${SHOT:-0}" 2>/dev/null || true
	"$CONTAINER" rm -f "$NAME" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

# The host: sshd with one user, trusting a key that exists only for this run.
ssh-keygen -q -t ed25519 -N '' -f "$WORK/id_probe" -C sirius-probe
mkdir -p "$WORK/image"
cp "$HERE/remote-ssh/Dockerfile" "$WORK/image/"
cp "$WORK/id_probe.pub" "$WORK/image/authorized_keys"
"$CONTAINER" build -q -t sirius-sshd-probe "$WORK/image" >/dev/null
"$CONTAINER" rm -f "$NAME" >/dev/null 2>&1 || true
"$CONTAINER" run -d --name "$NAME" -p "127.0.0.1:$PORT:22" sirius-sshd-probe >/dev/null
for _ in $(seq 1 30); do
	ssh -q -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$WORK/id_probe" -p "$PORT" dev@127.0.0.1 true 2>/dev/null && break
	sleep 1
done
echo "sshd up on 127.0.0.1:$PORT ($("$CONTAINER" exec "$NAME" sh -c '. /etc/os-release && echo $PRETTY_NAME'))"

# The extension, installed by the app's own CLI into a directory of its own.
VSIX=${SIRIUS_PROBE_VSIX:-}
if [[ -z "$VSIX" ]]; then
	mkdir -p "$WORK/vsix"
	URL=$(curl -sf https://open-vsx.org/api/jeanp413/open-remote-ssh/latest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).files.download))')
	VSIX=$WORK/vsix/$(basename "$URL")
	curl -sfL -o "$VSIX" "$URL"
fi
mkdir -p "$WORK/extensions"
env -u WAYLAND_DISPLAY "$APP/bin/sirius" --extensions-dir "$WORK/extensions" --user-data-dir "$WORK/install-profile" \
	--install-extension "$VSIX" 2>&1 | grep -E 'installed|rror' || true

# What the extension reads: its own SSH config file, named in the profile's settings.
cat > "$WORK/ssh_config" <<EOF
Host $HOST
	HostName 127.0.0.1
	Port $PORT
	User dev
	IdentityFile $WORK/id_probe
	IdentitiesOnly yes
EOF
printf '{ "remote.SSH.configFile": "%s" }\n' "$WORK/ssh_config" > "$WORK/settings.json"

# A screenshot of the Xvfb screen once the probe reports the remote window connected.
PNG=${OUT%.json}.png
rm -f "$OUT.connected" "$PNG"
( while [[ ! -f "$OUT.connected" ]]; do sleep 1; done; import -display :97 -window root "$PNG" 2>/dev/null ) & SHOT=$!

SIRIUS_PROBE_EXTENSIONS="$WORK/extensions" SIRIUS_PROBE_SETTINGS="$WORK/settings.json" \
SIRIUS_PROBE_SSHD="$NAME" SIRIUS_PROBE_SSH_HOST="$HOST" SIRIUS_CONTAINER="$CONTAINER" \
	"$HERE/run.sh" "$APP" "$HERE/probes/remote-ssh.js" "$OUT" "${SIRIUS_PROBE_WAIT:-180}"
echo
echo "── on the host ──"
"$CONTAINER" exec --user dev "$NAME" sh -c 'ls -la ~/.*-server/bin/*/bin 2>/dev/null; echo; tail -n 12 ~/.*-server/.*.log 2>/dev/null' || true
[[ -f "$PNG" ]] && echo "screenshot: $PNG"
