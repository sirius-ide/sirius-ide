#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Verify a published release from the outside — what a user downloads, not what CI
# built:
#   - every asset of the GitHub release, downloaded from dl.siriuside.com: the size
#     GitHub lists, the bytes its .sha256 sidecar names, `gh attestation verify`;
#   - commit.txt is the tag's commit;
#   - the update server offers linux-x64, linux-arm64 and win32-x64 their own asset
#     with the sidecar's sha256: 200 to an older client, 204 to a current one;
#   - the Arch repository lists exactly the new package, its two database pairs
#     identical, the package object the release asset's bytes;
#   - CI's own gates (abi-floor.sh, elf-arch.sh) rerun on the published tarballs,
#     servers, .deb and .rpm for x64 and arm64.
#
#   build/sirius/verify-release.sh <X.Y.Z> <previous X.Y.Z>
#
# Downloads (~1.3 GB) land in ${SIRIUS_VERIFY_DIR:-~/.cache/sirius-verify}/rel-<X.Y.Z>
# and are reused on a rerun. Needs gh, curl, jq, bsdtar, rpm, rpm2cpio, objdump, file.
# Exits non-zero when any check fails. PROJECT-STATE section 12, step 5.
#
# On a network whose resolver hands out a Cloudflare range it cannot route (the
# owner's, through 8.8.8.8 — PROJECT-STATE section 11), resolve through Cloudflare instead:
#   SIRIUS_CURL_OPTS='--doh-url https://1.1.1.1/dns-query' build/sirius/verify-release.sh …

set -uo pipefail
# shellcheck disable=SC2086  # SIRIUS_CURL_OPTS is a list of options, split on purpose
curl() { command curl ${SIRIUS_CURL_OPTS:-} "$@"; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)
V=${1:?usage: verify-release.sh <X.Y.Z> <previous X.Y.Z>}
PREV=${2:?usage: verify-release.sh <X.Y.Z> <previous X.Y.Z>}
TAG=v$V
R=sirius-ide/sirius-ide
CDN=https://dl.siriuside.com
D=${SIRIUS_VERIFY_DIR:-$HOME/.cache/sirius-verify}/rel-$V
mkdir -p "$D" && cd "$D" || exit 1

fails=0
bad() { echo "  FAIL: $*"; fails=$((fails + 1)); }
ok() { echo "  ok: $*"; }

echo "== GitHub release $TAG"
gh release view "$TAG" --repo $R --json assets --jq '.assets[] | "\(.size)\t\(.name)"' > assets.tsv || { echo "no release $TAG"; exit 1; }
gh release list --repo $R --limit 1 --json tagName,isLatest --jq '.[0] | "  latest: \(.tagName) \(.isLatest)"'
echo "  $(wc -l < assets.tsv) assets"
sed 's/^/    /' assets.tsv
tagcommit=$(git -C "$REPO" rev-parse "$TAG^{commit}" 2>/dev/null) || { git -C "$REPO" fetch -q origin "refs/tags/$TAG:refs/tags/$TAG"; tagcommit=$(git -C "$REPO" rev-parse "$TAG^{commit}"); }
commit=$(curl -fsSL "$CDN/releases/$TAG/commit.txt") || bad "commit.txt is not on the CDN"
[ "$commit" = "$tagcommit" ] && ok "commit.txt is the tag's commit ($commit)" || bad "commit.txt says $commit, the tag is $tagcommit"

echo "== every asset: CDN size = GitHub size, bytes = .sha256 sidecar, attested"
while IFS=$'\t' read -r size name; do
	url="$CDN/releases/$TAG/$name"
	if [ ! -f "$name" ] || [ "$(stat -c %s "$name")" != "$size" ]; then
		curl -fsSL -o "$name" "$url" || { bad "$name: download from the CDN failed"; continue; }
	fi
	got=$(stat -c %s "$name")
	[ "$got" = "$size" ] || { bad "$name: CDN serves $got bytes, GitHub lists $size"; continue; }
	line="$name: $size bytes"
	case $name in
		*.sha256) ;;
		*)
			sha=$(sha256sum "$name" | cut -d' ' -f1)
			if grep -q $'\t'"$name.sha256"'$' assets.tsv; then
				want=$(curl -fsSL "$url.sha256" | cut -d' ' -f1)
				if [ "$sha" = "$want" ]; then line+=", sha256 = sidecar"; else bad "$name: sha256 $sha, sidecar says $want"; fi
			fi
			if gh attestation verify "$name" --owner sirius-ide >/dev/null 2>&1; then line+=", attested"; else bad "$name: attestation does not verify"; fi
			;;
	esac
	ok "$line"
done < <(grep -v '\.sha256$' assets.tsv; grep '\.sha256$' assets.tsv)

echo "== update server"
prev=$(git -C "$REPO" rev-parse "v$PREV^{commit}")
for p in linux-x64 linux-arm64 win32-x64; do
	case $p in
		linux-x64) a=sirius-linux-x64.tar.gz ;;
		linux-arm64) a=sirius-linux-arm64.tar.gz ;;
		win32-x64) a=sirius-win32-x64-setup.exe ;;
	esac
	j=$(curl -fsS "https://update.siriuside.com/api/update/$p/stable/0000000000000000000000000000000000000000")
	want=$(cut -d' ' -f1 < "$a.sha256")
	if [ "$(jq -r .productVersion <<<"$j")" = "$V" ] && [ "$(jq -r .url <<<"$j")" = "$CDN/releases/$TAG/$a" ] \
		&& [ "$(jq -r .sha256hash <<<"$j")" = "$want" ] && [ "$(jq -r .version <<<"$j")" = "$commit" ]; then
		ok "$p: an old client is offered $V, $a, the sidecar's sha256 and the commit"
	else
		bad "$p: $j"
	fi
	s=$(curl -s -o /dev/null -w '%{http_code}' "https://update.siriuside.com/api/update/$p/stable/$prev")
	[ "$s" = 200 ] && ok "$p: a $PREV client -> 200" || bad "$p: a $PREV client -> $s"
	s=$(curl -s -o /dev/null -w '%{http_code}' "https://update.siriuside.com/api/update/$p/stable/$commit")
	[ "$s" = 204 ] && ok "$p: a $V client -> 204" || bad "$p: a $V client -> $s"
done

echo "== Arch repository"
for f in sirius.db sirius.db.tar.gz sirius.files sirius.files.tar.gz; do
	curl -fsSL -o "arch-$f" "$CDN/arch/x86_64/$f" || bad "arch/x86_64/$f is missing"
done
cmp -s arch-sirius.db arch-sirius.db.tar.gz && cmp -s arch-sirius.files arch-sirius.files.tar.gz \
	&& ok "both database pairs identical" || bad "the database pairs differ"
entries=$(tar -tzf arch-sirius.db | grep '/$' | tr '\n' ' ')
[ "$entries" = "sirius-ide-bin-$V-1/ " ] && ok "sirius.db lists exactly sirius-ide-bin-$V-1" || bad "sirius.db lists: $entries"
pk=sirius-ide-bin-$V-1-x86_64.pkg.tar.zst
cdn=$(curl -fsSL "$CDN/arch/x86_64/$pk" | sha256sum | cut -d' ' -f1)
rel=$(sha256sum "$pk" | cut -d' ' -f1)
[ "$cdn" = "$rel" ] && ok "arch/x86_64/$pk is the release asset's bytes" || bad "arch package $cdn, release asset $rel"
dbsha=$(tar -xzOf arch-sirius.db "sirius-ide-bin-$V-1/desc" | awk '/^%SHA256SUM%/{getline; print}')
[ "$dbsha" = "$rel" ] && ok "sirius.db's %SHA256SUM% matches" || bad "sirius.db's %SHA256SUM% is $dbsha"

echo "== package contents, through CI's own gates on the published bytes"
B="$REPO/build/sirius"
gate() { # <label> <app dir> <x64|arm64> <client|server>
	local label=$1 dir=$2 arch=$3 layout=$4 cxx out
	[ -d "$dir" ] || { bad "$label: no app directory $dir"; return; }
	if [ "$layout" = server ]; then cxx=3.4.25; elif [ "$arch" = x64 ]; then cxx=none; else cxx=3.4.26; fi
	if out=$(APP_DIR=$dir LAYOUT=$layout MAX_GLIBC=2.28 MAX_GLIBCXX=$cxx bash "$B/abi-floor.sh" 2>&1); then
		ok "$label: $(tail -1 <<<"$out")"
	else
		bad "$label: ABI floor"; tail -15 <<<"$out" | sed 's/^/      /'
	fi
	if out=$(ARCH=$arch bash "$B/elf-arch.sh" "$dir" 2>&1); then
		ok "$label: $(tail -1 <<<"$out")"
	else
		bad "$label: ELF architecture"; tail -15 <<<"$out" | sed 's/^/      /'
	fi
}
for arch in arm64 x64; do
	rm -rf x && mkdir x && bsdtar -xzf "sirius-linux-$arch.tar.gz" -C x && gate "tarball $arch" "x/VSCode-linux-$arch" $arch client
	rm -rf x && mkdir x && bsdtar -xzf "sirius-server-linux-$arch.tar.gz" -C x && gate "server $arch" "x/sirius-server-linux-$arch" $arch server
done
for pair in arm64:arm64 amd64:x64; do
	debarch=${pair%%:*} arch=${pair#*:}
	deb=$(ls sirius_*_"$debarch".deb 2>/dev/null | head -1)
	[ -n "$deb" ] || { bad "no $debarch .deb"; continue; }
	rm -rf x && mkdir -p x/c x/d && (cd x && bsdtar -xf "../$deb" && bsdtar -xf control.tar.* -C c && bsdtar -xf data.tar.* -C d)
	grep -q "^Architecture: $debarch$" x/c/control && ok "$deb: Architecture $debarch" || bad "$deb: wrong Architecture"
	echo "    Depends: $(grep '^Depends:' x/c/control | cut -c10-)"
	gate ".deb $debarch" x/d/usr/share/sirius $arch client
done
for pair in aarch64:arm64 x86_64:x64; do
	rarch=${pair%%:*} arch=${pair#*:}
	rpmf=$(ls sirius-*."$rarch".rpm 2>/dev/null | head -1)
	[ -n "$rpmf" ] || { bad "no $rarch .rpm"; continue; }
	q=$(rpm -qp --qf '%{ARCH}' "$rpmf" 2>/dev/null)
	[ "$q" = "$rarch" ] && ok "$rpmf: ARCH $rarch" || bad "$rpmf: ARCH $q"
	rm -rf x && mkdir x && (cd x && rpm2cpio "../$rpmf" | bsdtar -xf -) && gate ".rpm $rarch" x/usr/share/sirius $arch client
done
rm -rf x

echo
if [ $fails = 0 ]; then echo "ALL CHECKS PASSED"; else echo "$fails CHECK(S) FAILED"; exit 1; fi
