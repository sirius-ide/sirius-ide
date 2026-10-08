#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Put this checkout's sirius-ai into a built or released app, so a probe runs against the
# extension as it is now without a full product build (20+ minutes). Bundles with esbuild,
# then writes what the real build ships (build/lib/extensions.ts): the manifest with `main`
# at the bundle and the npm fields dropped, dist/extension.js, media/ and agents/. The release's own
# copy is kept once as ../sirius-ai.orig.
#
#   test/harness/swap-sirius-ai.sh <app-dir>     # e.g. ~/.cache/sirius-verify/app-1.118.9/VSCode-linux-x64
#
# Only the extension changes: anything under src/ needs a real build (a CI rehearsal's
# linux-x64 artifact is the quick one). A profile that already ran the app caches the old
# manifest (CachedProfilesData/*/extensions.builtin.cache) — run.sh uses a fresh one.

set -euo pipefail
APP=${1:?usage: $0 <app-dir>}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC=$ROOT/extensions/sirius-ai
DEST=$APP/resources/app/extensions/sirius-ai
[[ -d "$DEST" ]] || { echo "no sirius-ai in $APP"; exit 1; }

( cd "$SRC" && node esbuild.mts )
[[ -d "$DEST.orig" ]] || cp -a "$DEST" "$DEST.orig"

rm -rf "$DEST"
mkdir -p "$DEST/dist"
cp "$SRC/dist/extension.js" "$DEST/dist/"
for dir in media agents; do   # what .vscodeignore lets ship beside the bundle
	[[ -d "$SRC/$dir" ]] && cp -a "$SRC/$dir" "$DEST/"
done
node -e '
	const fs = require("fs");
	const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
	pkg.main = "./dist/extension.js";
	delete pkg.scripts; delete pkg.dependencies; delete pkg.devDependencies;
	fs.writeFileSync(process.argv[2], JSON.stringify(pkg, null, "\t"));
' "$SRC/package.json" "$DEST/package.json"
echo "sirius-ai from $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet -- extensions/sirius-ai || echo '+dirty') → $DEST"
