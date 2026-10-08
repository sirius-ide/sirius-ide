#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# The "Get started with Sirius" walkthrough's pictures, taken from the real app: each step's
# scene is driven with the keyboard in a private Xvfb display at 2× scale, cropped, and written
# as WebP in Sirius Star Dark and Light Modern. Re-run it when the UI those scenes show changes.
#
#   test/harness/walkthrough-media.sh <app-dir> [out-dir] [--full]
#
# out-dir defaults to extensions/sirius-ai/media/walkthrough. --full keeps whole-screen PNGs
# instead (to choose crops). The app should carry this checkout's sirius-ai
# (test/harness/swap-sirius-ai.sh). Needs Xvfb, xdotool, ImageMagick 7 with WebP, node, and a
# local Ollama with qwen2.5-coder:1.5b — the Tab suggestion is real. SIRIUS_MEDIA_MODELS names
# the models the filter below shows.
#
# Nothing of the machine shows: a throwaway HOME and profile, an in-memory keyring, Ollama
# behind test/harness/ollama-allowlist.mjs so only that model is listed, and LM Studio and
# llama.cpp pointed nowhere.

set -euo pipefail
APP=${1:?usage: $0 <app-dir> [out-dir] [--full]}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${2:-$ROOT/extensions/sirius-ai/media/walkthrough}
FULL=0; [[ "${3:-}" == --full ]] && FULL=1
DISP=${SIRIUS_MEDIA_DISPLAY:-:94}
PROXY_PORT=${SIRIUS_MEDIA_OLLAMA_PORT:-11435}
MODELS=${SIRIUS_MEDIA_MODELS:-qwen2.5-coder:1.5b}
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
key() { x key --clearmodifiers "$@"; sleep 0.4; }
typ() { x type --delay 25 -- "$1"; sleep 0.4; }
palette() { key ctrl+shift+p; sleep 1; typ "$1"; sleep 1; key Return; }
open_file() { key ctrl+p; sleep 1; typ "$1"; sleep 1; key Return; sleep 1.5; }

# shot <name> <theme> <x> <y> <w> <h> — the crop is in logical pixels (the window is 1440×900).
shot() {
	local name=$1 theme=$2 cx=$3 cy=$4 cw=$5 ch=$6 png="$WORK/$1-$2.png"
	DISPLAY=$DISP import -window root "$png"
	if [[ $FULL = 1 ]]; then
		cp "$png" "$OUT/$name-$theme.png"
	else
		magick "$png" -crop "$((cw * 2))x$((ch * 2))+$((cx * 2))+$((cy * 2))" +repage \
			-quality 90 -define webp:method=6 "$OUT/$name-$theme.webp"
	fi
	echo "  $name-$theme"
}

# A small project to show: the token bucket the website's surfaces use. Each theme gets a fresh
# copy — the agent's turn may write files.
mkdir -p "$WORK/home/.config/Code/User"
echo '{}' > "$WORK/home/.config/Code/User/settings.json"   # an editor to import from
make_workspace() {
	WS=$1
	mkdir -p "$WS/src"
	cat > "$WS/AGENTS.md" <<'EOF'
# aurora

A rate-limited HTTP API in TypeScript.

## Commands
- Build: pnpm build
- Test: pnpm test (vitest)

## Rules
- Never use npm or yarn.
- Tests sit beside the code they test.
- Never log request bodies.
- Do not touch generated/.
- Ask before adding a dependency.
EOF
	cat > "$WS/src/limiter.ts" <<'EOF'
export interface Bucket {
	tokens: number;
	updatedAt: number;
}

const CAPACITY = 20;
const REFILL_PER_SECOND = 5;
const buckets = new Map<string, Bucket>();

export function take(key: string, now = Date.now()): boolean {
	const bucket = buckets.get(key) ?? { tokens: CAPACITY, updatedAt: now };
	const elapsed = (now - bucket.updatedAt) / 1000;
	bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND);
	bucket.updatedAt = now;
	if (bucket.tokens < 1) {
		buckets.set(key, bucket);
		return false;
	}
	bucket.tokens -= 1;
	buckets.set(key, bucket);
	return true;
}
EOF
printf '{ "name": "aurora", "private": true }\n' > "$WS/package.json"
}

node "$ROOT/test/harness/ollama-allowlist.mjs" "$PROXY_PORT" http://127.0.0.1:11434 "$MODELS" &
PROXY=$!
sleep 1
# Load every model now, so the Tab suggestion does not wait on a cold load.
for shown in $(tr ',' '\n' <<<"$MODELS" | cut -d= -f1); do
	curl -s "http://127.0.0.1:$PROXY_PORT/api/generate" \
		-d "{\"model\":\"$shown\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\",\"options\":{\"num_predict\":1}}" >/dev/null
done
Xvfb "$DISP" -screen 0 2880x1800x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
sleep 2

for theme in dark light; do
	case $theme in
		dark) theme_id='Sirius Star Dark' ;;
		light) theme_id='Default Light Modern' ;;
	esac
	UD=$WORK/profile-$theme
	make_workspace "$WORK/$theme/aurora"
	mkdir -p "$UD/User"
	cat > "$UD/User/settings.json" <<EOF
{
	"workbench.colorTheme": "$theme_id",
	"workbench.startupEditor": "none",
	"workbench.tips.enabled": false,
	"editor.minimap.enabled": false,
	"security.workspace.trust.enabled": false,
	"update.mode": "none",
	"git.enabled": false,
	"sirius.ai.ollama.endpoint": "http://127.0.0.1:$PROXY_PORT",
	"sirius.ai.lmstudio.baseUrl": "http://127.0.0.1:9/v1",
	"sirius.ai.llamacpp.baseUrl": "",
	"sirius.ai.defaultProvider": "ollama",
	"sirius.ai.defaultModel": "qwen2.5-coder:1.5b",
	"sirius.ai.enable": { "*": true },
	"sirius.ai.completions.model": "ollama/qwen2.5-coder:1.5b"
}
EOF
	echo "== $theme"
	HOME=$WORK/home DISPLAY=$DISP "$APP/bin/sirius" --user-data-dir="$UD" --extensions-dir="$WORK/ext-$theme" \
		--no-sandbox --disable-gpu --use-inmemory-secretstorage --ozone-platform=x11 --skip-welcome \
		--force-device-scale-factor=2 --new-window "$WS" >/dev/null 2>&1 &
	WIN=$(x search --sync --onlyvisible --name 'Sirius' | head -1)
	x windowmove "$WIN" 0 0 windowsize "$WIN" 2880 1800
	sleep 14
	key ctrl+k w   # the walkthrough opens itself on a first start; the scenes want a clean editor

	# Crops share one shape (about 1.72:1), so the page does not jump between steps.
	palette 'Sirius: Set API Key'; sleep 2
	shot connect $theme 420 0 600 349
	key Escape

	open_file limiter.ts
	key ctrl+g; typ 10; key Return
	for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13; do key shift+Down; done
	key ctrl+i; sleep 2
	typ 'Also return how long until the next token'; sleep 1
	shot inline $theme 348 70 792 460
	key Escape; key Escape

	open_file AGENTS.md
	shot rules $theme 48 36 792 460

	palette 'Sirius: Import from'; sleep 1.5
	key Return; sleep 1.5
	shot import $theme 420 0 600 349
	key Escape

	key ctrl+k; key ctrl+t; sleep 2
	shot theme $theme 341 0 757 440
	key Escape

	open_file limiter.ts
	key ctrl+End; key Return; key Return
	typ 'export function reset(key: string): void {'; key Return
	sleep 9
	shot tab $theme 348 250 792 460
	key Escape

	# Last, because it widens the chat (dragging its sash from 1140 to 880) and the editor
	# scenes above crop the editor at its default width.
	x mousemove 2281 900 mousedown 1 mousemove 2000 900 mousemove 1761 900 mouseup 1; sleep 1
	key ctrl+alt+i; sleep 1.5
	key ctrl+period; sleep 2
	shot modes $theme 880 548 560 326
	key Escape

	pkill -f -- "--user-data-dir=$UD" || true
	sleep 2
done
ls -la "$OUT"
