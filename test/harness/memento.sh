#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# The panel's choices against stock VS Code's global state: compiles the panel's Kept
# (extensions/sirius-ai/src/panel/kept.ts) and runs probes/memento.js through vscode-run.sh, which
# writes two values a few milliseconds apart, straight to globalState and through Kept.
#   test/harness/memento.sh <vscode-dir> <result.json>
set -euo pipefail
APP=${1:?vscode dir, e.g. ~/.cache/sirius-verify/vscode-1.146.0/VSCode-linux-x64}
OUT=${2:?result path}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
KEPT=$(mktemp --suffix=.js)
trap 'rm -f "$KEPT"' EXIT
( cd "$ROOT/extensions/sirius-ai" && node -e '
	require("esbuild").buildSync({ entryPoints: ["src/panel/kept.ts"], bundle: true, format: "cjs", platform: "node", outfile: process.argv[1], logLevel: "error" });
' "$KEPT" )
( cd "$ROOT/extensions/sirius-ai" && node esbuild-edition.mts >/dev/null )
SIRIUS_KEPT_JS="$KEPT" "$HERE/vscode-run.sh" "$APP" "$ROOT/extensions/sirius-ai/dist/edition" "$HERE/probes/memento.js" "$OUT" 200
