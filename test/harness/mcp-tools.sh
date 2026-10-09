#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# MCP tools in the chat (hole 16), end to end in a built app: the OpenAI stub stands in for the
# model (it calls an mcp_*_echo tool when offered one), the stub MCP server sits in the profile's
# mcp.json as a user-level server, and the workspace carries an agent that names the server.
# Prints the probe's JSON, then every request the OpenAI stub saw with the tool names it was
# offered.
#
#   test/harness/mcp-tools.sh <app-dir> [result.json]

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.11-providers/VSCode-linux-x64}
OUT=${2:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
USERDIR=$(mktemp -d)
STUBLOG=$(mktemp)

cat > "$USERDIR/mcp.json" <<JSON
{ "servers": { "sirius-stub": { "type": "stdio", "command": "$(command -v node)", "args": ["$HERE/mcp-stub.mjs"] } } }
JSON

node "$HERE/openai-stub.mjs" 11991 good-key >"$STUBLOG" 2>&1 & STUB=$!
trap 'kill "$STUB" 2>/dev/null || true; rm -rf "$USERDIR" "$STUBLOG"' EXIT
sleep 1

SIRIUS_PROBE_USER="$USERDIR" SIRIUS_PROBE_SETTINGS="$HERE/seeds/provider-settings/settings.json" \
SIRIUS_PROBE_SEED="$HERE/seeds/mcp-tools" \
	"$HERE/run.sh" "$APP" "$HERE/probes/mcp-tools.js" "$OUT" "${SIRIUS_PROBE_WAIT:-120}"
echo
echo "── openai-stub requests ──"
cat "$STUBLOG"
