#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# A chat probe in a built app against the hosted stub (hosted-stub.mjs on port 11992), with the
# window's debugging port open so the probe can read the chat's DOM over CDP. Prints the probe's
# JSON, then every request the stub saw.
#   test/harness/chat-stub.sh <app-dir> <probe.js> [result.json]
# Probes written for it:
#   probes/thinking.js    — thinking on screen (streams, closes, opens on a click) and on the wire
#                           (a tool round carries it back unchanged; on a thinking budget a missing
#                           block is refused); Stop mid-thought closes the connection
#   probes/agent-loop.js  — the agent loop: a tool call written as prose runs as a real call, and a
#                           call to a tool the mode does not offer is refused

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.14-edition/VSCode-linux-x64}
PROBE=${2:?probe script, e.g. test/harness/probes/thinking.js}
OUT=${3:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${SIRIUS_PROBE_CDP_PORT:-9339}
HOSTEDLOG=$(mktemp)

# Both ports must be free: an old stub would answer for the new one, and an old window would hold
# the debugging port the new one needs.
if curl -s -o /dev/null http://127.0.0.1:11992/__requests || curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then
	echo "port 11992 or $PORT is in use — a stub or app from an earlier run is still up" >&2
	exit 1
fi
node "$HERE/hosted-stub.mjs" 11992 good-key >"$HOSTEDLOG" 2>&1 & HOSTED=$!
trap 'kill "$HOSTED" 2>/dev/null || true; rm -f "$HOSTEDLOG"' EXIT
for _ in $(seq 1 50); do
	curl -sf -o /dev/null http://127.0.0.1:11992/__requests && break
	sleep 0.2
done
kill -0 "$HOSTED" 2>/dev/null || { echo "the hosted stub did not start: $(cat "$HOSTEDLOG")" >&2; exit 1; }

SIRIUS_PROBE_ARGS="--remote-debugging-port=$PORT" SIRIUS_PROBE_CDP_PORT="$PORT" \
	"$HERE/run.sh" "$APP" "$PROBE" "$OUT" "${SIRIUS_PROBE_WAIT:-120}"
echo
echo "── hosted-stub requests ──"
cat "$HOSTEDLOG"
