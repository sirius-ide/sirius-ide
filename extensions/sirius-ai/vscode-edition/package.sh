#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# Sirius for VS Code as a .vsix: the edition's build (esbuild-edition.mts), the stable-API gate
# (tsconfig.json here: the edition's import graph against VS Code's stable typings at its floor,
# nothing else), a manifest that names no proposed API (vsce 4.1 packages one that does without a
# word and refuses it only at publish), then `vsce package` with no proposal flag.
#   (cd extensions/sirius-ai/vscode-edition/tools && npm ci --ignore-scripts)
#   extensions/sirius-ai/vscode-edition/package.sh [out.vsix]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$HERE/tools/node_modules/.bin
[ -x "$BIN/vsce" ] || { echo "the tools are not installed: (cd $HERE/tools && npm ci --ignore-scripts)" >&2; exit 1; }
OUT=$(realpath -m "${1:-$HERE/../dist/sirius-ai.vsix}")
node "$HERE/../esbuild-edition.mts"
"$BIN/tsc" -p "$HERE"
echo "stable-API gate: passed"
node -e 'const m = require(process.argv[1]); const p = [...(m.enabledApiProposals ?? []), ...(m.enableProposedApi ? ["enableProposedApi"] : [])]; if (p.length) { console.error(`the manifest names proposed API: ${p.join(", ")}`); process.exit(1); }' "$HERE/../dist/edition/package.json"
echo "manifest: no proposed API"
cd "$HERE/../dist/edition"
"$BIN/vsce" package --no-dependencies --out "$OUT"
