#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Add a package to the [sirius] pacman repository served from R2 at
# dl.siriuside.com/arch/x86_64 — the step that used to be done by hand after
# every tag (PROJECT-STATE.md hole 4). Needs pacman's repo-add and vercmp (any
# Arch system, or Ubuntu's pacman-package-manager package, which is what the
# release workflow uses) and, for a real publish, the AWS CLI for R2.
#
#   build/sirius/publish-arch-repo.sh <pkg.tar.zst>            publish
#   build/sirius/publish-arch-repo.sh <pkg.tar.zst> --dry-run  repo-add only, no R2, no credentials
#
# Environment for a real publish: R2_ENDPOINT, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY (the same bucket-scoped token the release mirror uses).
#
# Three properties this script guarantees, because each has bitten a pacman
# repository somewhere:
#   1. Never a downgrade. A re-run of an older tag, or two tags finishing out
#      of order, must not put the older package back in the database. The
#      live entry is compared with vercmp before anything is uploaded, and
#      repo-add runs with --prevent-downgrade as a second net.
#   2. Never different bytes under an immutable name. Package objects are
#      served with a one-year immutable cache, so a rebuilt package with the
#      same file name must be byte-identical or refused (bump pkgrel — the
#      workflow's arch_pkgrel input). The sha256 travels as object metadata.
#   3. The package before the database. A client never sees a database entry
#      whose file 404s. The database objects carry no-cache so the CDN edge
#      never serves a stale index.

set -euo pipefail

pkg=${1:?usage: publish-arch-repo.sh <pkg.tar.zst> [--dry-run]}
dry=${2:-}
[ -f "$pkg" ] || { echo "::error::no such package: $pkg"; exit 1; }
pkgfile=$(basename "$pkg")
[[ "$pkgfile" =~ ^sirius-ide-bin-([0-9][^-]*)-([0-9]+)-x86_64\.pkg\.tar\.zst$ ]] || { echo "::error::unexpected package name: $pkgfile"; exit 1; }
newver="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
entry="sirius-ide-bin-$newver"
for tool in repo-add vercmp; do
	command -v "$tool" >/dev/null || { echo "::error::$tool not found; install pacman (Arch) or pacman-package-manager (Debian/Ubuntu)"; exit 1; }
done

bucket=sirius-releases
prefix=arch/x86_64
repo=sirius
public=https://dl.siriuside.com/$prefix

if [ "$dry" != --dry-run ]; then
	: "${R2_ENDPOINT:?R2_ENDPOINT is required (or pass --dry-run)}"
	: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
	export AWS_DEFAULT_REGION=auto
	command -v aws >/dev/null || { echo "::error::aws CLI not found"; exit 1; }
fi
aws_() { aws s3 "$@" --endpoint-url "$R2_ENDPOINT"; }
awsapi() { aws s3api "$@" --endpoint-url "$R2_ENDPOINT"; }

work=$(mktemp -d /tmp/sirius-arch-repo.XXXXXX)
cp "$pkg" "$work/"
cd "$work"
sha=$(sha256sum "$pkgfile" | cut -d' ' -f1)
echo "publishing $entry ($sha)"

echo "== current repository database"
if [ "$dry" = --dry-run ]; then
	echo "(dry run: starting from an empty database)"
else
	for f in "$repo.db.tar.gz" "$repo.files.tar.gz"; do
		aws_ cp "s3://$bucket/$prefix/$f" "./$f" 2>/dev/null && echo "fetched $f" || echo "no $f in the bucket yet (first publish)"
	done
fi

# 1. Never a downgrade.
if [ -f "$repo.db.tar.gz" ]; then
	current=$(tar -tzf "$repo.db.tar.gz" | grep -oE '^sirius-ide-bin-[^/]+' | head -1 | sed 's/^sirius-ide-bin-//' || true)
	if [ -n "$current" ]; then
		echo "database currently lists sirius-ide-bin-$current"
		case "$(vercmp "$newver" "$current")" in
			-1)
				echo "::notice::sirius-ide-bin-$current is already published and is newer than $newver; nothing to do"
				exit 0 ;;
			0)
				echo "sirius-ide-bin-$current is already the published version; re-verifying the objects only" ;;
		esac
	fi
fi

echo "== repo-add"
repo-add --prevent-downgrade --quiet "$repo.db.tar.gz" "$pkgfile"
echo "database now contains:"
tar -tzf "$repo.db.tar.gz" | grep '/$' | sed 's|/$||; s/^/  /'
tar -tzf "$repo.db.tar.gz" | grep -q "^$entry/" || { echo "::error::repo-add did not record $entry"; exit 1; }

if [ "$dry" = --dry-run ]; then
	echo "== dry run complete; nothing uploaded"
	exit 0
fi

# 2. Never different bytes under an immutable name.
echo "== package object"
if existing=$(awsapi head-object --bucket "$bucket" --key "$prefix/$pkgfile" 2>/dev/null); then
	remote_sha=$(printf '%s' "$existing" | sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' | head -1)
	if [ -z "$remote_sha" ]; then
		# An object published before this script recorded metadata: hash it.
		aws_ cp "s3://$bucket/$prefix/$pkgfile" ./remote.pkg >/dev/null
		remote_sha=$(sha256sum ./remote.pkg | cut -d' ' -f1)
	fi
	if [ "$remote_sha" = "$sha" ]; then
		echo "$pkgfile is already in the bucket with the same bytes; not re-uploading"
	else
		echo "::error::$pkgfile already exists in the bucket with different bytes (bucket $remote_sha, this build $sha). It is served as immutable, so it cannot be replaced: republish with a higher pkgrel (workflow input arch_pkgrel)."
		exit 1
	fi
else
	aws_ cp "./$pkgfile" "s3://$bucket/$prefix/$pkgfile" \
		--cache-control 'public, max-age=31536000, immutable' --content-type application/zstd \
		--metadata "sha256=$sha"
fi

# 3. The package before the database. pacman fetches sirius.db and
# sirius.files; repo-add makes them symlinks to the .tar.gz files, and object
# stores have no symlinks, so the same bytes go up under both names.
echo "== database objects"
for f in db files; do
	aws_ cp "./$repo.$f.tar.gz" "s3://$bucket/$prefix/$repo.$f.tar.gz" --cache-control 'no-cache' --content-type application/gzip
	aws_ cp "./$repo.$f.tar.gz" "s3://$bucket/$prefix/$repo.$f"        --cache-control 'no-cache' --content-type application/gzip
done

echo "== verify through the public CDN"
# The db object is uncached, so the new entry must be visible at once; the
# loop only covers propagation jitter.
for attempt in $(seq 1 12); do
	if curl -fsSL "$public/$repo.db" | tar -tz 2>/dev/null | grep -q "^$entry/"; then
		echo "$public/$repo.db lists $entry"
		break
	fi
	[ "$attempt" = 12 ] && { echo "::error::$public/$repo.db does not list $entry after upload"; exit 1; }
	sleep 5
done
cdn_sha=$(curl -fsSL "$public/$pkgfile" | sha256sum | cut -d' ' -f1)
[ "$cdn_sha" = "$sha" ] || { echo "::error::$public/$pkgfile serves $cdn_sha, expected $sha"; exit 1; }
echo "$public/$pkgfile serves the published bytes"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
	{
		echo "### Arch repository"
		echo
		echo "\`[sirius]\` now serves \`$entry\` from \`$public\` (sha256 \`$sha\`)."
	} >> "$GITHUB_STEP_SUMMARY"
fi
echo "== published $entry"
