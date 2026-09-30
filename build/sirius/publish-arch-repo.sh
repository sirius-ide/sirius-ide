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
#   build/sirius/publish-arch-repo.test.sh                     the self-test: this script against a stub R2
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
#
# And one rule that keeps the three honest: a question the bucket did not
# answer is never taken as "absent". Every existence check is a HeadObject
# with exactly two accepted answers, 200 (present) and 404 (absent). A 403, a
# timeout, a wrong endpoint or a failed download stops the publish with the
# CLI's own message — because "the database could not be fetched" read as
# "there is no database yet" would skip the downgrade check and replace the
# live index with one that lists only this package. The four database objects
# — $repo.db.tar.gz and $repo.files.tar.gz, which repo-add builds on, and
# $repo.db and $repo.files, the copies pacman reads — must all be present or
# all be absent: anything in between is a half-finished (or half-deleted)
# repository, and this script will not build on it.

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
	# object_status reads the "(404)" out of the CLI's error line. That line is
	# what the CLI prints by default; a cli_error_format of json, text, yaml or
	# table in some ~/.aws/config would drop the parentheses and turn every
	# absent key into "cannot tell". The environment beats the config file,
	# and a CLI too old to know the setting ignores it.
	export AWS_CLI_ERROR_FORMAT=legacy
	command -v aws >/dev/null || { echo "::error::aws CLI not found"; exit 1; }
fi
aws_() { aws s3 "$@" --endpoint-url "$R2_ENDPOINT"; }
awsapi() { aws s3api "$@" --endpoint-url "$R2_ENDPOINT"; }

# object_status <key>: does the object exist? 0 = yes (HeadObject's answer is
# left in $work/head.json), 1 = the bucket answered 404, 2 = the bucket did not
# answer — the CLI's message has been printed as an error annotation and the
# caller must stop. R2 answers HeadObject on a missing key with 404 (unlike S3,
# it has no 403-for-missing when the token cannot list, and the mirror token
# can list this bucket anyway), so a 403 here is a credential or scope problem,
# never absence.
object_status() {
	local key=$1 rc=0
	awsapi head-object --bucket "$bucket" --key "$key" >"$work/head.json" 2>"$work/head.err" || rc=$?
	[ "$rc" = 0 ] && return 0
	if grep -qE '\((404|NotFound|NoSuchKey)\)' "$work/head.err"; then
		return 1
	fi
	echo "::error::cannot tell whether s3://$bucket/$key exists (aws exit $rc): $(tr -s '\n' ' ' <"$work/head.err")"
	return 2
}

work=$(mktemp -d /tmp/sirius-arch-repo.XXXXXX)
trap 'rm -rf "${work:?}"' EXIT
cp "$pkg" "$work/"
cd "$work"
sha=$(sha256sum "$pkgfile" | cut -d' ' -f1)
echo "publishing $entry ($sha)"

echo "== current repository database"
if [ "$dry" = --dry-run ]; then
	echo "(dry run: starting from an empty database)"
else
	# All four database objects, or none. pacman reads $repo.db and
	# $repo.files; repo-add builds on the .tar.gz pair; step 3 uploads the four
	# together. Checking only the pair would let a bucket where the pair is
	# gone but $repo.db survived pass as a first publish — and the "first"
	# database would then replace the one clients are still reading.
	present=(); absent=()
	for f in "$repo.db.tar.gz" "$repo.files.tar.gz" "$repo.db" "$repo.files"; do
		object_status "$prefix/$f" && rc=0 || rc=$?
		case $rc in
			0) present+=("$f") ;;
			1) absent+=("$f"); echo "$f: 404 from the bucket" ;;
			*) exit 1 ;;
		esac
	done
	if [ ${#absent[@]} = 0 ]; then
		for f in "$repo.db.tar.gz" "$repo.files.tar.gz"; do
			aws_ cp "s3://$bucket/$prefix/$f" "./$f" >/dev/null \
				|| { echo "::error::$f exists in the bucket but could not be downloaded; not publishing on top of a database this run has not seen"; exit 1; }
			echo "fetched $f"
		done
	elif [ ${#present[@]} = 0 ]; then
		echo "::warning::s3://$bucket/$prefix/ has no $repo database (all four database objects 404): first publish, creating the repository"
	else
		echo "::error::s3://$bucket/$prefix/ has ${present[*]} but not ${absent[*]} — a half-finished repository. Restore or remove all four database objects by hand before publishing."
		exit 1
	fi
fi

# 1. Never a downgrade.
if [ -f "$repo.db.tar.gz" ]; then
	listing=$(tar -tzf "$repo.db.tar.gz") || { echo "::error::the fetched $repo.db.tar.gz is not a readable pacman database; not publishing on top of it"; exit 1; }
	current=$(printf '%s\n' "$listing" | grep -oE '^sirius-ide-bin-[^/]+' | head -1 | sed 's/^sirius-ide-bin-//' || true)
	if [ -n "$current" ]; then
		echo "database currently lists sirius-ide-bin-$current"
		case "$(vercmp "$newver" "$current")" in
			-1)
				echo "::notice::sirius-ide-bin-$current is already published and is newer than $newver; nothing to do"
				exit 0 ;;
			0)
				echo "sirius-ide-bin-$current is already the published version; re-verifying the objects only" ;;
		esac
	else
		echo "database lists no sirius-ide-bin entry"
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
object_status "$prefix/$pkgfile" && rc=0 || rc=$?
case $rc in
	0)
		remote_sha=$(sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' "$work/head.json" | head -1)
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
		fi ;;
	1)
		aws_ cp "./$pkgfile" "s3://$bucket/$prefix/$pkgfile" \
			--cache-control 'public, max-age=31536000, immutable' --content-type application/zstd \
			--metadata "sha256=$sha" ;;
	*)
		exit 1 ;;
esac

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
