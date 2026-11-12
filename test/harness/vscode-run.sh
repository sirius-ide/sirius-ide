#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# Run a probe inside stock VS Code with Sirius's VS Code edition, against a fresh profile:
#   test/harness/vscode-run.sh <vscode-dir> <edition-dir> <probe-script.js> <result.json> [wait, in 2 s steps]
# <vscode-dir> is an unpacked Microsoft build (…/VSCode-linux-x64), left untouched: the edition
# (extensions/sirius-ai/dist/edition, from `node esbuild-edition.mts`) and the probe extension both
# load as development extensions. The window's debugging port is open (SIRIUS_PROBE_CDP_PORT,
# default 9341) so a probe can read the window and the panel's webview over CDP.
# SIRIUS_PROBE_SETTINGS=<file> becomes the profile's settings.json. The probe finds the profile's
# folder in SIRIUS_PROBE_USER_DIR, to look at what was written there. Nothing a run opens outside
# reaches the desktop: VS Code's `xdg-open` and `xdg-email` only write the address to the file named
# in SIRIUS_PROBE_OPENED, for the probe to read, and the app gets a D-Bus session of its own, so a
# file shown in the file manager goes nowhere. The profile's settings always draw dialogs in the
# window (a probe answers them there) and never name an outside browser; SIRIUS_PROBE_SETTINGS
# (JSON) is laid over the defaults.

set -euo pipefail
APP=${1:?vscode dir, e.g. ~/.cache/sirius-verify/vscode-1.146.0/VSCode-linux-x64}
EDITION=$(realpath "${2:?edition dir, e.g. extensions/sirius-ai/dist/edition}")
PROBE=$(realpath "${3:?probe script}")
OUT=$(realpath -m "${4:?result path}")
WAIT=${5:-90}
PORT=${SIRIUS_PROBE_CDP_PORT:-9341}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)

app_pids() { ps -eo pid,args --no-headers | awk -v a="$APP/" '$2 ~ "^"a {print $1}'; }
reap() {
	app_pids | while read -r p; do kill "$p" 2>/dev/null; done
	for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(app_pids)" ] && return 0; sleep 0.5; done
	app_pids | while read -r p; do kill -9 "$p" 2>/dev/null; done
}
cleanup() { reap; sleep 1; kill "${XP:-0}" "${BUSPID:-0}" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

if curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then
	echo "port $PORT is in use — an app from an earlier run is still up" >&2
	exit 1
fi
rm -f "$OUT"
mkdir -p "$WORK/user/User" "$WORK/ws" "$WORK/extensions" "$WORK/bin"
for opener in xdg-open xdg-email; do
	printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\n' "$WORK/opened.log" > "$WORK/bin/$opener"
	chmod +x "$WORK/bin/$opener"
done
# The forked daemon keeps whatever its output went to, so the address and pid go to files: a pipe
# would never end.
dbus-daemon --session --fork --print-address=3 --print-pid=4 3>"$WORK/bus.address" 4>"$WORK/bus.pid"
BUS=$(head -n1 "$WORK/bus.address"); BUSPID=$(head -n1 "$WORK/bus.pid")
node -e '
	const fs = require("fs");
	const [file, extra] = process.argv.slice(1);
	const settings = { "update.mode": "none", "telemetry.telemetryLevel": "off", "workbench.startupEditor": "none", "extensions.autoUpdate": false, ...(extra ? JSON.parse(fs.readFileSync(extra, "utf8")) : {}) };
	settings["window.dialogStyle"] = "custom";
	delete settings["workbench.externalBrowser"];
	fs.writeFileSync(file, JSON.stringify(settings, null, "\t") + "\n");
' "$WORK/user/User/settings.json" "${SIRIUS_PROBE_SETTINGS:-}"

reap; pgrep -x Xvfb >/dev/null && pkill -x Xvfb || true; sleep 1
Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 & XP=$!
sleep 2

env -u WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS="$BUS" PATH="$WORK/bin:$PATH" SIRIUS_PROBE_SCRIPT="$PROBE" SIRIUS_PROBE_OUT="$OUT" SIRIUS_PROBE_CDP_PORT="$PORT" SIRIUS_PROBE_USER_DIR="$WORK/user" SIRIUS_PROBE_OPENED="$WORK/opened.log" DISPLAY=:97 \
	"$APP/bin/code" --ozone-platform=x11 --user-data-dir="$WORK/user" --extensions-dir="$WORK/extensions" \
	--extensionDevelopmentPath="$EDITION" --extensionDevelopmentPath="$HERE/probe-ext" \
	--no-sandbox --disable-gpu --disable-workspace-trust --use-inmemory-secretstorage \
	--skip-welcome --skip-release-notes --remote-debugging-port="$PORT" "$WORK/ws" >"$OUT.app.log" 2>&1 &

for _ in $(seq 1 "$WAIT"); do
	[ -s "$OUT" ] && break
	sleep 2
done
[ -s "$OUT" ] || { echo "probe produced no result within ${WAIT}x2s" >&2; exit 1; }
cat "$OUT"
