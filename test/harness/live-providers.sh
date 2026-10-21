#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# The hosted providers live: a real request each to Anthropic and Google Gemini through a built
# app, with keys from outside the repository. The keys file — ~/.secrets/ai-keys.env, or the
# path in SIRIUS_AI_KEYS — holds ANTHROPIC_API_KEY=… and GEMINI_API_KEY=…, one per line (an
# `export` prefix, quotes and a trailing comment are fine). They reach the probe through the
# environment only — of this script, the harness and the app it starts — the profile's secret
# storage is in memory for the run, and the result and log never carry a key. A run spends a few
# short requests on the two cheapest models each vendor offers (or exactly the ids in
# SIRIUS_PROBE_ANTHROPIC_MODELS / SIRIUS_PROBE_GEMINI_MODELS). A vendor whose key is missing is
# reported as skipped, and the run fails. Beside the result: <result>.log with the progress and
# <result>.partial.json with what was done so far, for a run the harness gives up on.
#
#   test/harness/live-providers.sh <app-dir> [result.json]

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.13/VSCode-linux-x64}
OUT=${2:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
KEYS=${SIRIUS_AI_KEYS:-$HOME/.secrets/ai-keys.env}

[[ -f "$KEYS" ]] || { echo "no keys file at $KEYS — ANTHROPIC_API_KEY=… and GEMINI_API_KEY=…, one per line" >&2; exit 1; }

# The last NAME=value line: an `export` prefix, single or double quotes and a trailing comment
# are allowed; an unquoted value ends at the first blank or `#`.
read_key() {
	local line value
	line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$KEYS" | tail -1) || true
	[[ -n "$line" ]] || return 0
	value=${line#*=}
	value=${value#"${value%%[![:space:]]*}"}
	case $value in
		\"*) value=${value#\"}; value=${value%%\"*} ;;
		\'*) value=${value#\'}; value=${value%%\'*} ;;
		*) value=${value%%[[:space:]]*}; value=${value%%#*} ;;
	esac
	printf '%s' "$value"
}
ANTHROPIC=$(read_key ANTHROPIC_API_KEY)
GEMINI=$(read_key GEMINI_API_KEY)
[[ -n "$ANTHROPIC" || -n "$GEMINI" ]] || { echo "neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set in $KEYS" >&2; exit 1; }
[[ -n "$ANTHROPIC" ]] || echo "no ANTHROPIC_API_KEY in $KEYS — Anthropic will be skipped" >&2
[[ -n "$GEMINI" ]] || echo "no GEMINI_API_KEY in $KEYS — Gemini will be skipped" >&2

echo "result: $OUT (progress in $OUT.log, the steps so far in $OUT.partial.json)"
SIRIUS_PROBE_ANTHROPIC_KEY="$ANTHROPIC" SIRIUS_PROBE_GEMINI_KEY="$GEMINI" \
	"$HERE/run.sh" "$APP" "$HERE/probes/live-providers.js" "$OUT" "${SIRIUS_PROBE_WAIT:-300}"
