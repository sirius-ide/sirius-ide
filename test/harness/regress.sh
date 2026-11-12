#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# The IDE's regression set, every probe in turn, on one built app; each probe's JSON, its output and
# a line per probe ("<probe> exit=<n> <seconds>s") in <out-dir>. Run it on the published app and on
# the app with this checkout's extension swapped in (swap-sirius-ai.sh), then compare the two with
# compare-results.js: apart from paths, ports, timings, ids and a local model's sampling, they should
# match field by field.
#
#   TMPDIR=~/.cache/sirius-verify/tmp test/harness/regress.sh <app-dir> <out-dir>     (after `nvm use`)
#
# Needs local Ollama models (chat-modes, agent-tools, docs-pass-fixes, prompted-tools); prompted-tools
# drives a 14B model that runs mostly on the CPU here, so it gets 600 s, not 180.
set -uo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.14/VSCode-linux-x64}
OUT=${2:?out dir}
H=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
cd "$H/../.."
t() { local name=$1; shift; SECONDS=0; "$@" > "$OUT/$name.out" 2>&1; echo "$name exit=$? ${SECONDS}s"; }
t provider-gaps "$H/provider-gaps.sh" "$APP" "$OUT/provider-gaps.json"
t mcp-tools "$H/mcp-tools.sh" "$APP" "$OUT/mcp-tools.json"
t thinking "$H/chat-stub.sh" "$APP" "$H/probes/thinking.js" "$OUT/thinking.json"
t agent-loop "$H/chat-stub.sh" "$APP" "$H/probes/agent-loop.js" "$OUT/agent-loop.json"
SIRIUS_PROBE_SEED="$H/seeds/chat-modes" t chat-modes "$H/run.sh" "$APP" "$H/probes/chat-modes.js" "$OUT/chat-modes.json"
for p in docs-pass-fixes agent-tools flagged-bugs project-rules walkthrough; do
	t "$p" "$H/run.sh" "$APP" "$H/probes/$p.js" "$OUT/$p.json"
done
node "$H/openai-stub.mjs" 11991 good-key > "$OUT/openai-stub.log" 2>&1 & STUB=$!
sleep 1
SIRIUS_PROBE_SETTINGS="$H/seeds/provider-settings/settings.json" t provider-settings "$H/run.sh" "$APP" "$H/probes/provider-settings.js" "$OUT/provider-settings.json"
kill "$STUB" 2>/dev/null
t prompted-tools "$H/run.sh" "$APP" "$H/probes/prompted-tools.js" "$OUT/prompted-tools.json" 300
echo done
