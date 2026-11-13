#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# A probe of Sirius's VS Code edition in stock VS Code, against the hosted stub (Anthropic's,
# Gemini's and Ollama's shapes, port 11992) and the OpenAI-compatible stub (port 11991): builds the
# edition (extensions/sirius-ai/esbuild-edition.mts), then runs vscode-run.sh. Prints the probe's
# JSON, then every request the stubs saw; the probe reads the OpenAI stub's log
# (SIRIUS_PROBE_STUBLOG) to see what each request carried. The workspace is seeds/edition; the
# profile's mcp.json names one MCP server, sirius-stub (mcp-stub.mjs: echo, read-only, and
# write_note, which VS Code asks about); probe-tools-ext adds another extension's tool.
#   test/harness/edition-stub.sh <vscode-dir> <probe.js> [result.json]
# SIRIUS_PROBE_PACKAGED=1 packages the edition instead (extensions/sirius-ai/vscode-edition/package.sh:
# the build, the stable-API gate, `vsce package`; its tools installed first) into <result>.vsix, and the
# run installs that package as a user would rather than loading the folder as a development extension.
# Probes written for it: probes/panel.js — Sirius's panel: the walkthrough, setup, every provider
# family, thinking, replay, modes and effort, tools and approvals, changes to files reviewed in the
# diff editor, Copy, errors, Stop, Retry, the send key, conversations, a tab, a reload, the page's
# security policy, the key at rest.

set -euo pipefail
APP=${1:?vscode dir, e.g. ~/.cache/sirius-verify/vscode-1.146.0/VSCode-linux-x64}
PROBE=${2:?probe script, e.g. test/harness/probes/panel.js}
OUT=${3:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
HOSTEDLOG=$(mktemp)
STUBLOG=$(mktemp)
USERDIR=$(mktemp -d)
cat > "$USERDIR/mcp.json" <<JSON
{ "servers": { "sirius-stub": { "type": "stdio", "command": "$(command -v node)", "args": ["$HERE/mcp-stub.mjs"] } } }
JSON

if [ -n "${SIRIUS_PROBE_PACKAGED:-}" ]; then
	"$ROOT/extensions/sirius-ai/vscode-edition/package.sh" "${OUT%.json}.vsix" >"${OUT%.json}.package.log" 2>&1 \
		|| { echo "packaging failed: $(tail -20 "${OUT%.json}.package.log")" >&2; exit 1; }
	export SIRIUS_PROBE_VSIX="${OUT%.json}.vsix"
else
	( cd "$ROOT/extensions/sirius-ai" && node esbuild-edition.mts >/dev/null )
fi
if curl -s -o /dev/null http://127.0.0.1:11992/__requests || curl -s -o /dev/null http://127.0.0.1:11991/v1/models; then
	echo "port 11992 or 11991 is in use — a stub from an earlier run is still up" >&2
	exit 1
fi
node "$HERE/hosted-stub.mjs" 11992 good-key >"$HOSTEDLOG" 2>&1 & HOSTED=$!
node "$HERE/openai-stub.mjs" 11991 good-key >"$STUBLOG" 2>&1 & STUB=$!
trap 'kill "$HOSTED" "$STUB" 2>/dev/null || true; rm -rf "$HOSTEDLOG" "$STUBLOG" "$USERDIR"' EXIT
for _ in $(seq 1 50); do
	curl -sf -o /dev/null http://127.0.0.1:11992/__requests && curl -s -o /dev/null http://127.0.0.1:11991/v1/models && break
	sleep 0.2
done
kill -0 "$HOSTED" 2>/dev/null || { echo "the hosted stub did not start: $(cat "$HOSTEDLOG")" >&2; exit 1; }
kill -0 "$STUB" 2>/dev/null || { echo "the OpenAI-compatible stub did not start: $(cat "$STUBLOG")" >&2; exit 1; }

rm -f "$OUT.before-reload.json"
export SIRIUS_PROBE_STUBLOG="$STUBLOG" SIRIUS_PROBE_SEED="$HERE/seeds/edition" SIRIUS_PROBE_USER="$USERDIR" SIRIUS_PROBE_EXTRA_EXT="$HERE/probe-tools-ext"
status=0
"$HERE/vscode-run.sh" "$APP" "$ROOT/extensions/sirius-ai/dist/edition" "$PROBE" "$OUT" "${SIRIUS_PROBE_WAIT:-450}" || status=$?
echo
echo "── hosted-stub requests ──"
cat "$HOSTEDLOG"
echo "── openai-stub requests ──"
cat "$STUBLOG"
exit "$status"
