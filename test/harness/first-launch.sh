#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# What a new user sees: Sirius started for the very first time — a throwaway HOME and
# profile, and no --skip-welcome, unlike run.sh — in a private Xvfb display, screenshotted.
#
#   test/harness/first-launch.sh <app-dir> <out-dir> [none|local]
#
# none (default): no model reachable (Ollama, LM Studio and llama.cpp pointed nowhere), so the
# walkthrough's first step is open. local: Ollama behind test/harness/ollama-allowlist.mjs with
# qwen2.5-coder:1.5b, so that step shows done. Writes 1-first-start.png, then 2-welcome.png
# (Help: Welcome — the walkthroughs a user can pick from), then 3-<scheme>.png per theme
# (Sirius Star Dark is the first start's own; Light Modern is set afterwards).

set -euo pipefail
APP=${1:?usage: $0 <app-dir> <out-dir> [none|local]}
OUT=${2:?out dir}
MODE=${3:-none}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DISP=${SIRIUS_FIRST_LAUNCH_DISPLAY:-:95}
PROXY_PORT=${SIRIUS_FIRST_LAUNCH_OLLAMA_PORT:-11436}
mkdir -p "$OUT"

WORK=$(mktemp -d)
cleanup() {
	pkill -f -- "--user-data-dir=$WORK/" 2>/dev/null || true
	[[ -n "${PROXY:-}" ]] && kill "$PROXY" 2>/dev/null || true
	[[ -n "${XVFB:-}" ]] && kill "$XVFB" 2>/dev/null || true
	rm -rf "$WORK"
}
trap cleanup EXIT
x() { DISPLAY=$DISP xdotool "$@"; }
key() { x key --clearmodifiers "$@"; sleep 0.5; }
shot() { DISPLAY=$DISP import -window root "$OUT/$1.png"; echo "  $OUT/$1.png"; }

case $MODE in
	none) ollama=http://127.0.0.1:9 ;;
	local)
		node "$ROOT/test/harness/ollama-allowlist.mjs" "$PROXY_PORT" http://127.0.0.1:11434 qwen2.5-coder:1.5b >/dev/null &
		PROXY=$!
		ollama=http://127.0.0.1:$PROXY_PORT ;;
	*) echo "mode is none or local"; exit 2 ;;
esac

# Only where Sirius looks for models is set — nothing that changes what a first start shows.
mkdir -p "$WORK/home" "$WORK/profile/User"
cat > "$WORK/profile/User/settings.json" <<EOF
{
	"sirius.ai.ollama.endpoint": "$ollama",
	"sirius.ai.lmstudio.baseUrl": "http://127.0.0.1:9/v1",
	"sirius.ai.llamacpp.baseUrl": ""
}
EOF

Xvfb "$DISP" -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
sleep 2
HOME=$WORK/home DISPLAY=$DISP "$APP/bin/sirius" --user-data-dir="$WORK/profile" --extensions-dir="$WORK/ext" \
	--no-sandbox --disable-gpu --use-inmemory-secretstorage --ozone-platform=x11 --new-window >/dev/null 2>&1 &
WIN=$(x search --sync --onlyvisible --name 'Sirius' | head -1)
x windowmove "$WIN" 0 0 windowsize "$WIN" 1440 900
sleep 25
shot 1-first-start

key ctrl+shift+p; sleep 1; x type --delay 25 'Help: Welcome'; sleep 1; key Return; sleep 3
shot 2-welcome

python3 - "$WORK/profile/User/settings.json" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings['workbench.colorTheme'] = 'Default Light Modern'
json.dump(settings, open(path, 'w'), indent='\t')
PY
key ctrl+shift+p; sleep 1; x type --delay 25 'Welcome: Open Walkthrough'; sleep 1; key Return; sleep 1.5
x type --delay 25 'Get started with Sirius'; sleep 1; key Return; sleep 3
shot 3-light
