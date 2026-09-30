#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Build sirius-ide-bin from a release tarball, install the result, and prove it
# runs. Runs as root inside an Arch Linux container (archlinux:base-devel); the
# release workflow calls it, and it works the same from a laptop:
#
#   docker run --rm -v "$PWD:/w" -w /w archlinux:base-devel \
#     bash build/arch/build.sh sirius-linux-x64.tar.gz 1.118.6 out/
#
#   build/arch/build.sh <sirius-linux-x64.tar.gz> <version> [<out-dir>]
#
# PKGREL (default 1) sets the package release. A tag's package is uploaded as
# an immutable object; republishing the same version needs a new pkgrel.
#
# The PKGBUILD's source URL points at the GitHub release of <version>, which
# does not exist yet while the release is being built. makepkg skips a
# download whose file is already present under the PKGBUILD, so the tarball is
# placed there under the name the URL would produce: the package is built from
# the run's own artifact and is byte-for-byte what a user building the same
# PKGBUILD against the published release gets. updpkgsums then records the
# real checksums, so the PKGBUILD that ships in .SRCINFO is complete.

set -euo pipefail

usage() { echo "usage: $0 <sirius-linux-x64.tar.gz> <version> [<out-dir>]" >&2; exit 2; }
[ $# -ge 2 ] || usage

tarball=$(readlink -f "$1")
version=$2
out=$(readlink -f "${3:-.}")
here=$(cd "$(dirname "$0")" && pwd)
pkgrel=${PKGREL:-1}

[ -f "$tarball" ] || { echo "::error::no such tarball: $tarball"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "::error::run as root inside an Arch container; makepkg is delegated to an unprivileged user"; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::version must be X.Y.Z, got '$version'"; exit 1; }
[[ "$pkgrel" =~ ^[1-9][0-9]*$ ]] || { echo "::error::PKGREL must be a positive integer, got '$pkgrel'"; exit 1; }
mkdir -p "$out"

echo "== toolchain"
# The container image's keyring can predate the mirrors' signatures; refresh it
# before anything else, then bring the base system current.
pacman -Sy --noconfirm --needed archlinux-keyring >/dev/null
pacman -Syu --noconfirm --needed pacman-contrib namcap >/dev/null
id builder >/dev/null 2>&1 || useradd -m builder

echo "== the tarball carries what the PKGBUILD installs"
for p in \
	VSCode-linux-x64/sirius \
	VSCode-linux-x64/bin/sirius \
	VSCode-linux-x64/resources/app/resources/linux/code.png \
	VSCode-linux-x64/resources/app/LICENSE.txt \
	VSCode-linux-x64/resources/app/ThirdPartyNotices.txt \
	VSCode-linux-x64/resources/completions/bash/sirius \
	VSCode-linux-x64/resources/completions/zsh/_sirius; do
	tar -tzf "$tarball" "$p" >/dev/null 2>&1 || { echo "::error::$p is missing from the tarball; the PKGBUILD's package() would fail"; exit 1; }
done

build=$(mktemp -d /tmp/sirius-ide-bin.XXXXXX)
cp "$here"/sirius-ide-bin/* "$build/"
sed -i -e "s/^pkgver=.*/pkgver=$version/" -e "s/^pkgrel=.*/pkgrel=$pkgrel/" "$build/PKGBUILD"
cp "$tarball" "$build/sirius-ide-bin-$version-x64.tar.gz"
chown -R builder "$build"

echo "== makepkg"
# --nodeps: this is a binary repack, nothing is compiled, and the runtime
# dependencies are exercised by the install below rather than by makepkg.
runuser -u builder -- bash -ec "
	cd '$build'
	updpkgsums
	makepkg --noconfirm --nodeps --cleanbuild
	makepkg --printsrcinfo > .SRCINFO
"
pkg="$build/sirius-ide-bin-$version-$pkgrel-x86_64.pkg.tar.zst"
[ -f "$pkg" ] || { echo "::error::makepkg did not produce $(basename "$pkg")"; ls "$build"; exit 1; }
echo "built $(basename "$pkg") ($(du -h "$pkg" | cut -f1))"

echo "== namcap (advisory)"
namcap -i "$build/PKGBUILD" || true
namcap "$pkg" || true

echo "== install: pacman resolves every runtime dependency from the mirrors"
pacman -U --noconfirm "$pkg"

echo "== run"
# The launcher refuses to run as root without --user-data-dir; --version is
# served by the CLI entry point, so no display is needed.
sirius --version --user-data-dir=/tmp/sirius-ud | tee /tmp/sirius-version.txt
[ "$(head -1 /tmp/sirius-version.txt)" = "$version" ] || { echo "::error::sirius --version reported '$(head -1 /tmp/sirius-version.txt)', expected $version"; exit 1; }

echo "== linkage: every shipped binary resolves against the declared depends"
missing=0
checked=0
while IFS= read -r f; do
	[ -f "$f" ] || { echo "::error::$f is missing from the installed package"; missing=1; continue; }
	checked=$((checked + 1))
	if ldd "$f" 2>/dev/null | grep -q 'not found'; then
		echo "::error::$f: $(ldd "$f" | grep 'not found' | tr -s ' ' | tr '\n' ';')"
		missing=1
	fi
done < <(printf '%s\n' /opt/sirius-ide/sirius /opt/sirius-ide/chrome-sandbox /opt/sirius-ide/chrome_crashpad_handler; \
	find /opt/sirius-ide/resources/app/node_modules -name '*.node' -not -path '*/obj.target/*' \
		| grep -vE 'windows-foreground-love|deviceid/build/Release/windows\.node|win32-|-msvc-')
[ "$missing" = 0 ] || { echo "::error::a shipped binary needs a library the PKGBUILD does not declare; add it to depends"; exit 1; }
[ "$checked" -ge 8 ] || { echo "::error::only $checked binaries inspected; the installed tree looks incomplete"; exit 1; }
echo "$checked binaries resolve every shared library"

echo "== desktop integration"
desktop-file-validate /usr/share/applications/sirius.desktop /usr/share/applications/sirius-url-handler.desktop 2>/dev/null \
	|| { pacman -S --noconfirm --needed desktop-file-utils >/dev/null; desktop-file-validate /usr/share/applications/sirius.desktop /usr/share/applications/sirius-url-handler.desktop; }
for f in /usr/bin/sirius /usr/share/pixmaps/sirius.png /usr/share/mime/packages/sirius-workspace.xml \
	/usr/share/bash-completion/completions/sirius /usr/share/zsh/site-functions/_sirius \
	/usr/share/licenses/sirius-ide-bin/LICENSE.txt; do
	[ -e "$f" ] || { echo "::error::$f is missing from the installed package"; exit 1; }
done

cp "$pkg" "$out/"
cp "$build/.SRCINFO" "$out/sirius-ide-bin.SRCINFO"
(cd "$out" && sha256sum "$(basename "$pkg")" > "$(basename "$pkg").sha256")
echo "== done: $out/$(basename "$pkg")"
