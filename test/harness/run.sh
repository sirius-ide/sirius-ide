#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Run a probe script inside a headless build of Sirius against a fresh profile:
#
#   test/harness/run.sh <app-dir> <probe-script.js> <result.json> [timeout-s]
#
# The probe module must export run(vscode) returning a JSON-serialisable value.

set -euo pipefail
APP=${1:?app dir, e.g. ~/Projects/VSCode-linux-x64}
PROBE=$(realpath "${2:?probe script}")
OUT=$(realpath -m "${3:?result path}")
WAIT=${4:-90}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)

reap() { ps -eo pid,args --no-headers | awk -v a="$APP/" '$2 ~ "^"a {print $1}' | while read -r p; do kill "$p" 2>/dev/null; done; }
cleanup() { reap; sleep 1; kill "${XP:-0}" 2>/dev/null || true; rm -rf "$WORK" "$APP/resources/app/extensions/sirius-probe"; }
trap cleanup EXIT

rm -f "$OUT"
mkdir -p "$WORK/user/User" "$WORK/ws" "$WORK/empty"
cp -r "$HERE/probe-ext" "$APP/resources/app/extensions/sirius-probe"

reap; pgrep -x Xvfb >/dev/null && pkill -x Xvfb || true; sleep 1
Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 & XP=$!
sleep 2

SIRIUS_PROBE_SCRIPT="$PROBE" SIRIUS_PROBE_OUT="$OUT" SIRIUS_AGENT_DEBUG=1 DISPLAY=:97 \
	"$APP/bin/sirius" --user-data-dir="$WORK/user" --extensions-dir="$WORK/empty" \
	--no-sandbox --disable-gpu --disable-workspace-trust --use-inmemory-secretstorage \
	--skip-welcome --skip-release-notes --disable-updates "$WORK/ws" >/dev/null 2>&1 &

for _ in $(seq 1 "$WAIT"); do
	[ -s "$OUT" ] && break
	sleep 2
done
[ -s "$OUT" ] || { echo "probe produced no result within ${WAIT}x2s" >&2; exit 1; }
cat "$OUT"
