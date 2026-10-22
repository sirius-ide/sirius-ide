#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# The provider gaps that need no key to be real, in a built app against stubs: Anthropic's
# models discovered through a paged `GET /v1/models` and each request shaped from the model's
# capabilities (thinking as adaptive, a budget, disabled or nothing; effort only where it is
# taken, stepped down to a level the model has; temperature only on the old generation); a
# Gemini key Google refuses with HTTP 400 shown as a rejected key; the Anthropic and Gemini
# Base URL fields; and a stopped request ending at the server for every provider family —
# the hosted stub (Anthropic, Gemini, Ollama shapes) and the OpenAI stub each hold a reply
# until the client lets go. Prints the probe's JSON, then every request the stubs saw.
#
#   test/harness/provider-gaps.sh <app-dir> [result.json]

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.13-gaps/VSCode-linux-x64}
OUT=${2:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
STUBLOG=$(mktemp)
HOSTEDLOG=$(mktemp)

node "$HERE/openai-stub.mjs" 11991 good-key >"$STUBLOG" 2>&1 & STUB=$!
node "$HERE/hosted-stub.mjs" 11992 good-key >"$HOSTEDLOG" 2>&1 & HOSTED=$!
trap 'kill "$STUB" "$HOSTED" 2>/dev/null || true; rm -f "$STUBLOG" "$HOSTEDLOG"' EXIT
for _ in $(seq 1 50); do
	curl -sf -o /dev/null http://127.0.0.1:11992/__requests && curl -s -o /dev/null http://127.0.0.1:11991/v1/models && break
	sleep 0.2
done

SIRIUS_PROBE_STUBLOG="$STUBLOG" \
	"$HERE/run.sh" "$APP" "$HERE/probes/provider-gaps.js" "$OUT" "${SIRIUS_PROBE_WAIT:-150}"
echo
echo "── hosted-stub requests ──"
cat "$HOSTEDLOG"
echo "── openai-stub requests ──"
cat "$STUBLOG"
