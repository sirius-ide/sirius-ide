#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# A probe of Sirius's VS Code edition in stock VS Code, against the hosted stub (port 11992):
# builds the edition (extensions/sirius-ai/esbuild-edition.mts), then runs vscode-run.sh. Prints
# the probe's JSON, then every request the stub saw.
#   test/harness/edition-stub.sh <vscode-dir> <probe.js> [result.json]
# Probes written for it: probes/panel.js — Sirius's panel: setup, thinking, replay, Stop, Retry,
# conversations, a tab, a reload.

set -euo pipefail
APP=${1:?vscode dir, e.g. ~/.cache/sirius-verify/vscode-1.146.0/VSCode-linux-x64}
PROBE=${2:?probe script, e.g. test/harness/probes/panel.js}
OUT=${3:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
HOSTEDLOG=$(mktemp)

( cd "$ROOT/extensions/sirius-ai" && node esbuild-edition.mts >/dev/null )
if curl -s -o /dev/null http://127.0.0.1:11992/__requests; then
	echo "port 11992 is in use — a stub from an earlier run is still up" >&2
	exit 1
fi
node "$HERE/hosted-stub.mjs" 11992 good-key >"$HOSTEDLOG" 2>&1 & HOSTED=$!
trap 'kill "$HOSTED" 2>/dev/null || true; rm -f "$HOSTEDLOG"' EXIT
for _ in $(seq 1 50); do
	curl -sf -o /dev/null http://127.0.0.1:11992/__requests && break
	sleep 0.2
done
kill -0 "$HOSTED" 2>/dev/null || { echo "the hosted stub did not start: $(cat "$HOSTEDLOG")" >&2; exit 1; }

rm -f "$OUT.before-reload.json"
"$HERE/vscode-run.sh" "$APP" "$ROOT/extensions/sirius-ai/dist/edition" "$PROBE" "$OUT" "${SIRIUS_PROBE_WAIT:-150}"
echo
echo "── hosted-stub requests ──"
cat "$HOSTEDLOG"
