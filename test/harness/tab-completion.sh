#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Tab completion against a real llama-server, end to end in a built app: the official llama.cpp
# server image serves a FIM model with `--api-key`, and the probe drives the editor against it —
# no key refused, the server added in Manage Models, a completion accepted into the file.
# The model is Ollama's qwen2.5-coder:1.5b GGUF (the harness's core-tier model) unless
# SIRIUS_FIM_GGUF names another file. Needs podman (SIRIUS_CONTAINER=docker works too).
#
#   test/harness/tab-completion.sh <app-dir> [result.json]

set -euo pipefail
APP=${1:?app dir, e.g. ~/.cache/sirius-verify/app-1.118.12/VSCode-linux-x64}
OUT=${2:-$(mktemp --suffix=.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
CONTAINER=${SIRIUS_CONTAINER:-podman}
IMAGE=ghcr.io/ggml-org/llama.cpp:server
NAME=sirius-llama-fim
PORT=18080
KEY=sirius-fim-key

GGUF=${SIRIUS_FIM_GGUF:-$(ollama show --modelfile qwen2.5-coder:1.5b 2>/dev/null | awk '/^FROM /{print $2}')}
[[ -f "$GGUF" ]] || { echo "no GGUF: pull qwen2.5-coder:1.5b in Ollama or set SIRIUS_FIM_GGUF" >&2; exit 1; }

"$CONTAINER" rm -f "$NAME" >/dev/null 2>&1 || true
"$CONTAINER" run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -v "$GGUF:/models/model.gguf:ro,Z" "$IMAGE" \
	-m /models/model.gguf --host 0.0.0.0 --port 8080 -c 4096 --api-key "$KEY" >/dev/null
trap '"$CONTAINER" rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 90); do
	curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
	sleep 2
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "llama-server did not come up"; "$CONTAINER" logs "$NAME" | tail -20; exit 1; }
BUILD=$(curl -sf -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/props" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).build_info||"?"))' 2>/dev/null || echo '?')
echo "llama-server $BUILD up on :$PORT with $(basename "$GGUF") (image of $("$CONTAINER" image inspect "$IMAGE" --format '{{.Created}}' | cut -c1-10))"

SIRIUS_PROBE_LLAMA="http://127.0.0.1:$PORT" SIRIUS_PROBE_LLAMA_KEY="$KEY" \
	"$HERE/run.sh" "$APP" "$HERE/probes/tab-completion.js" "$OUT" "${SIRIUS_PROBE_WAIT:-120}"
