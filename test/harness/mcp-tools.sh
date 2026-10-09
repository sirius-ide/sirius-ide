#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# MCP tools in the chat (hole 16), end to end in a built app: the OpenAI stub stands in for the
# model (it calls the echo tool, or opens the big server and calls its first filler), three stub
# MCP servers sit in the profile's mcp.json as user-level servers — sirius-stub (2 tools),
# sirius-mid (20), sirius-big (70) — and the workspace carries an agent that names the first.
# Prints the probe's JSON, then every request the OpenAI stub saw with the tool names it was
# offered; the probe reads that log too (SIRIUS_PROBE_STUBLOG).
#
#   test/harness/mcp-tools.sh <app-dir> [result.json]

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.11-providers/VSCode-linux-x64}
OUT=${2:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
USERDIR=$(mktemp -d)
STUBLOG=$(mktemp)

NODE=$(command -v node)
cat > "$USERDIR/mcp.json" <<JSON
{ "servers": {
	"sirius-stub": { "type": "stdio", "command": "$NODE", "args": ["$HERE/mcp-stub.mjs"] },
	"sirius-mid": { "type": "stdio", "command": "$NODE", "args": ["$HERE/mcp-stub.mjs", "--tools", "20"] },
	"sirius-big": { "type": "stdio", "command": "$NODE", "args": ["$HERE/mcp-stub.mjs", "--tools", "70"] }
} }
JSON

node "$HERE/openai-stub.mjs" 11991 good-key >"$STUBLOG" 2>&1 & STUB=$!
trap 'kill "$STUB" 2>/dev/null || true; rm -rf "$USERDIR" "$STUBLOG"' EXIT
sleep 1

SIRIUS_PROBE_USER="$USERDIR" SIRIUS_PROBE_SETTINGS="$HERE/seeds/provider-settings/settings.json" \
SIRIUS_PROBE_SEED="$HERE/seeds/mcp-tools" SIRIUS_PROBE_STUBLOG="$STUBLOG" \
	"$HERE/run.sh" "$APP" "$HERE/probes/mcp-tools.js" "$OUT" "${SIRIUS_PROBE_WAIT:-180}"
echo
echo "── openai-stub requests ──"
cat "$STUBLOG"
