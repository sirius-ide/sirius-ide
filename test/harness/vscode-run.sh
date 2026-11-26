#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# Run a probe inside stock VS Code with Sirius's VS Code edition, against a fresh profile:
#   test/harness/vscode-run.sh <vscode-dir> <edition-dir> <probe-script.js> <result.json> [wait, in 2 s steps]
# <vscode-dir> is an unpacked Microsoft build (…/VSCode-linux-x64; get-vscode.sh fetches one), stable
# or Insiders — or a Sirius IDE app, for probes/in-ide.js — left untouched: the edition
# (extensions/sirius-ai/dist/edition, from `node esbuild-edition.mts`) and the probe extension both
# load as development extensions. The window's debugging port is open (SIRIUS_PROBE_CDP_PORT,
# default 9341) so a probe can read the window and the panel's webview over CDP.
# SIRIUS_PROBE_SETTINGS=<file> becomes the profile's settings.json. The probe finds the profile's
# folder in SIRIUS_PROBE_USER_DIR, to look at what was written there. Nothing a run opens outside
# reaches the desktop: VS Code's `xdg-open` and `xdg-email` only write the address to the file named
# in SIRIUS_PROBE_OPENED, for the probe to read, and the app gets a D-Bus session of its own, so a
# file shown in the file manager goes nowhere. The profile's settings always draw dialogs in the
# window (a probe answers them there) and never name an outside browser; SIRIUS_PROBE_SETTINGS
# (JSON) is laid over the defaults. SIRIUS_PROBE_SEED=<dir> is copied into the workspace and
# SIRIUS_PROBE_USER=<dir> into the profile's User folder (an mcp.json) before the app starts;
# SIRIUS_PROBE_EXTRA_EXT=<dir> loads one more development extension (probe-tools-ext).
# SIRIUS_PROBE_VSIX=<file> installs that package into the run's extensions folder — the edition as a
# user gets it — instead of loading <edition-dir> as a development extension; anything that is not
# a file is taken as an extension's id (siriuside.sirius-ai, or siriuside.sirius-ai@0.1.0 for one
# version), which VS Code installs from the Marketplace itself: the released edition.
# SIRIUS_PROBE_KEEP_LOGS=1 keeps VS Code's own logs beside the result (<result.json>.vscode-logs),
# for a run nobody watched. SIRIUS_PROBE_NO_FOLDER=1 opens a window with no folder (probes/no-folder.js)
# in place of the workspace.

set -euo pipefail
APP=${1:?vscode dir, e.g. ~/.cache/sirius-verify/vscode-1.146.0/VSCode-linux-x64}
# The edition's folder must be there to be loaded; with a package to install it is not looked at.
EDITION=$(realpath ${SIRIUS_PROBE_VSIX:+-m} "${2:?edition dir, e.g. extensions/sirius-ai/dist/edition}")
PROBE=$(realpath "${3:?probe script}")
OUT=$(realpath -m "${4:?result path}")
WAIT=${5:-90}
PORT=${SIRIUS_PROBE_CDP_PORT:-9341}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
# Stock VS Code's launcher, stable's or Insiders', or Sirius IDE's (a probe of the edition inside
# the IDE: probes/in-ide.js).
BIN=code
[ -x "$APP/bin/$BIN" ] || BIN=code-insiders
[ -x "$APP/bin/$BIN" ] || BIN=sirius

app_pids() { ps -eo pid,args --no-headers | awk -v a="$APP/" '$2 ~ "^"a {print $1}'; }
reap() {
	app_pids | while read -r p; do kill "$p" 2>/dev/null || true; done
	for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(app_pids)" ] && return 0; sleep 0.5; done
	app_pids | while read -r p; do kill -9 "$p" 2>/dev/null || true; done
}
# Only what this run started: with no pid to name, `kill 0` would end the whole process group — the caller too.
cleanup() {
	reap; sleep 1
	for pid in "${XP:-}" "${BUSPID:-}"; do [ -z "$pid" ] || kill "$pid" 2>/dev/null || true; done
	if [ -n "${SIRIUS_PROBE_KEEP_LOGS:-}" ] && [ -d "$WORK/user/logs" ]; then
		rm -rf "$OUT.vscode-logs"; cp -r "$WORK/user/logs" "$OUT.vscode-logs" || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

if curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then
	echo "port $PORT is in use — an app from an earlier run is still up" >&2
	exit 1
fi
rm -f "$OUT"
mkdir -p "$WORK/user/User" "$WORK/ws" "$WORK/extensions" "$WORK/bin"
[ -n "${SIRIUS_PROBE_SEED:-}" ] && cp -r "$SIRIUS_PROBE_SEED"/. "$WORK/ws/"
[ -n "${SIRIUS_PROBE_USER:-}" ] && cp -r "$SIRIUS_PROBE_USER"/. "$WORK/user/User/"
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

EDITION_ARGS=(--extensionDevelopmentPath="$EDITION")
FOLDER=("$WORK/ws")
[ -n "${SIRIUS_PROBE_NO_FOLDER:-}" ] && FOLDER=()
if [ -n "${SIRIUS_PROBE_VSIX:-}" ]; then
	INSTALL=$SIRIUS_PROBE_VSIX
	[ -f "$INSTALL" ] && INSTALL=$(realpath "$INSTALL")
	"$APP/bin/$BIN" --user-data-dir="$WORK/user" --extensions-dir="$WORK/extensions" --install-extension "$INSTALL" >"$OUT.install.log" 2>&1 \
		|| { echo "$INSTALL did not install: $(cat "$OUT.install.log")" >&2; exit 1; }
	EDITION_ARGS=()
fi

reap; pgrep -x Xvfb >/dev/null && pkill -x Xvfb || true; sleep 1
Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 & XP=$!
sleep 2

env -u WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS="$BUS" PATH="$WORK/bin:$PATH" SIRIUS_PROBE_SCRIPT="$PROBE" SIRIUS_PROBE_OUT="$OUT" SIRIUS_PROBE_CDP_PORT="$PORT" SIRIUS_PROBE_USER_DIR="$WORK/user" SIRIUS_PROBE_OPENED="$WORK/opened.log" DISPLAY=:97 \
	"$APP/bin/$BIN" --ozone-platform=x11 --user-data-dir="$WORK/user" --extensions-dir="$WORK/extensions" \
	"${EDITION_ARGS[@]}" --extensionDevelopmentPath="$HERE/probe-ext" ${SIRIUS_PROBE_EXTRA_EXT:+--extensionDevelopmentPath="$SIRIUS_PROBE_EXTRA_EXT"} \
	--no-sandbox --disable-gpu --disable-workspace-trust --use-inmemory-secretstorage \
	--skip-welcome --skip-release-notes --remote-debugging-port="$PORT" "${FOLDER[@]}" >"$OUT.app.log" 2>&1 &

for _ in $(seq 1 "$WAIT"); do
	[ -s "$OUT" ] && break
	sleep 2
done
[ -s "$OUT" ] || { echo "probe produced no result within ${WAIT}x2s" >&2; exit 1; }
cat "$OUT"
