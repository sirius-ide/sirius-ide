#!/usr/bin/env bash
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# A Microsoft build of VS Code for the edition's probes, from Microsoft's update service:
#   test/harness/get-vscode.sh <stable|insider|1.145.3> <dir>
# asks update.code.visualstudio.com for the build — the newest stable, the newest Insiders, or one
# stable version — downloads its linux-x64 archive from Microsoft's download host, checks it against
# the SHA-256 the service names and unpacks it into <dir>/vscode-<version>/ (an Insiders build into
# <dir>/vscode-<version>-<commit>/: Insiders keeps one version through weeks of daily builds).
# The only line on stdout is the app's folder (…/VSCode-linux-x64), which edition-stub.sh and
# vscode-run.sh take. A build already unpacked there is not downloaded again, unless the checksum
# kept beside it is no longer the one the service names.

set -euo pipefail
WHICH=${1:?stable, insider, or a stable version such as 1.145.3}
DIR=$(realpath -m "${2:?where to unpack, e.g. ~/.cache/sirius-verify}")
API=https://update.code.visualstudio.com/api
case "$WHICH" in
	stable | insider) QUERY="$API/update/linux-x64/$WHICH/latest" ;;
	[0-9]*.[0-9]*.[0-9]*) QUERY="$API/versions/$WHICH/linux-x64/stable" ;;
	*) echo "not a build: $WHICH (stable, insider, or a version such as 1.145.3)" >&2; exit 1 ;;
esac
META=$(curl -fsSL --retry 3 --max-time 60 "$QUERY") || { echo "the update service did not answer for $WHICH" >&2; exit 1; }
# The address, the checksum, the version and the commit, each refused unless it is what it should
# be — and the version the one asked for.
read -r URL SHA VERSION COMMIT < <(node -e '
	const [answer, which] = process.argv.slice(1);
	const meta = JSON.parse(answer);
	const url = new URL(meta.url);
	if (url.protocol !== "https:" || !url.hostname.endsWith(".microsoft.com")) { throw new Error(`not a Microsoft download: ${meta.url}`); }
	if (!/^[0-9a-f]{64}$/.test(meta.sha256hash)) { throw new Error("no SHA-256 for the build"); }
	if (!/^[0-9a-f]{40}$/.test(meta.version)) { throw new Error("no commit for the build"); }
	const wanted = which === "insider" ? /^\d+\.\d+\.\d+-insider$/ : /^\d+\.\d+\.\d+$/;
	if (!wanted.test(meta.productVersion) || (which !== "stable" && which !== "insider" && meta.productVersion !== which)) { throw new Error(`asked for ${which}, offered ${meta.productVersion}`); }
	console.log(url.href, meta.sha256hash, meta.productVersion, meta.version);
' "$META" "$WHICH")
HOME_OF_BUILD="$DIR/vscode-$VERSION"
[ "$WHICH" = insider ] && HOME_OF_BUILD="$HOME_OF_BUILD-${COMMIT:0:10}"
APP="$HOME_OF_BUILD/VSCode-linux-x64"
if [ -x "$APP/bin/code" ] || [ -x "$APP/bin/code-insiders" ]; then
	if [ ! -f "$HOME_OF_BUILD/.sha256" ] || [ "$(cat "$HOME_OF_BUILD/.sha256")" = "$SHA" ]; then
		echo "VS Code $VERSION is already at $APP" >&2
		echo "$APP"
		exit 0
	fi
	echo "VS Code $VERSION at $APP is not the build the service names now: fetching it again" >&2
fi
mkdir -p "$DIR"
# Beside where it will stand, so the last step is a rename, not a copy across file systems.
WORK=$(mktemp -d "$DIR/.get-vscode.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
echo "downloading VS Code $VERSION" >&2
curl -fsSL --retry 3 --max-time 900 -o "$WORK/code.tar.gz" "$URL"
echo "$SHA  $WORK/code.tar.gz" | sha256sum -c - >&2
mkdir -p "$WORK/unpacked" "$HOME_OF_BUILD"
tar -xzf "$WORK/code.tar.gz" -C "$WORK/unpacked"
[ -d "$WORK/unpacked/VSCode-linux-x64" ] || { echo "the archive holds no VSCode-linux-x64: $(ls "$WORK/unpacked")" >&2; exit 1; }
rm -rf "$APP"
mv "$WORK/unpacked/VSCode-linux-x64" "$APP"
echo "$SHA" > "$HOME_OF_BUILD/.sha256"
echo "$APP"
