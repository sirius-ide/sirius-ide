#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Self-test for publish-arch-repo.sh. Runs the real script, in publish mode,
# with a stub `aws` and a stub `curl` ahead of it on PATH: a directory stands in
# for the R2 bucket, and each case tells the stub how HeadObject or GetObject
# answers. It proves the rule the script lives by — only a 404 means "absent";
# a 403, a connection failure, a failed download, a half-present or unreadable
# database all stop the publish before anything is uploaded, and the script
# pins the CLI's error format so the 404 stays recognisable — and the three
# properties around it (no downgrade, no different bytes under an immutable
# name, package before database). Needs repo-add, vercmp, bsdtar and zstd, the
# same tools the script needs; no network and no credentials.
#
#   build/sirius/publish-arch-repo.test.sh
#
# The release workflow runs it in the Rehearse step of every branch dispatch,
# next to the --dry-run of the real package.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script=$here/publish-arch-repo.sh
for tool in repo-add vercmp bsdtar zstd; do
	command -v "$tool" >/dev/null || { echo "::error::$tool not found; the self-test needs the same tools as the script"; exit 1; }
done

tmp=$(mktemp -d /tmp/sirius-arch-repo-test.XXXXXX)
trap 'rm -rf "${tmp:?}"' EXIT
bucket=$tmp/bucket           # s3://sirius-releases/<key> is $bucket/<key>
prefix=arch/x86_64
mkdir -p "$tmp/bin" "$tmp/pkgs"

# ---- the stub R2 -----------------------------------------------------------

cat >"$tmp/bin/aws" <<'STUB'
#!/usr/bin/env bash
# Stub AWS CLI for publish-arch-repo.test.sh. A directory is the bucket; an
# object's metadata sits beside it in <key>.meta and its upload headers in
# <key>.headers. Understands exactly the calls the script makes, logs each one
# to $STUB_LOG, and answers the way the real CLI does — including the fault the
# test asks for through STUB_HEAD_FAULT=<key suffix>=<403|500|connect> and
# STUB_GET_FAULT=<key suffix>.
set -euo pipefail
echo "aws $*" >>"$STUB_LOG"
[ "${AWS_ACCESS_KEY_ID:-}" = test-key ] && [ "${AWS_SECRET_ACCESS_KEY:-}" = test-secret ] || { echo "stub: called without the test credentials" >&2; exit 99; }
svc=$1; shift
args=(); endpoint=
while [ $# -gt 0 ]; do
	case $1 in
		--endpoint-url) endpoint=$2; shift 2 ;;
		*) args+=("$1"); shift ;;
	esac
done
[ "$endpoint" = "$R2_ENDPOINT" ] || { echo "stub: --endpoint-url is '$endpoint', expected '$R2_ENDPOINT'" >&2; exit 99; }
set -- "${args[@]}"
op=$1; shift

fault_for() { # <key> <spec: suffix=mode> → prints mode when the key matches
	local key=$1 spec=${2:-}
	[ -n "$spec" ] || return 0
	[[ "$key" == *"${spec%%=*}" ]] && printf '%s' "${spec#*=}"
	return 0
}

case "$svc $op" in
	"s3api head-object")
		bucket_name=; key=
		while [ $# -gt 0 ]; do
			case $1 in
				--bucket) bucket_name=$2; shift 2 ;;
				--key) key=$2; shift 2 ;;
				*) echo "stub: unexpected head-object argument $1" >&2; exit 99 ;;
			esac
		done
		[ "$bucket_name" = sirius-releases ] || { echo "stub: wrong bucket $bucket_name" >&2; exit 99; }
		case "$(fault_for "$key" "${STUB_HEAD_FAULT:-}")" in
			403) echo "An error occurred (403) when calling the HeadObject operation: Forbidden" >&2; exit 254 ;;
			500) echo "An error occurred (500) when calling the HeadObject operation: Internal Error" >&2; exit 254 ;;
			connect) echo "Could not connect to the endpoint URL: \"$R2_ENDPOINT/sirius-releases/$key\"" >&2; exit 255 ;;
		esac
		if [ -f "$STUB_BUCKET/$key" ]; then
			if [ -f "$STUB_BUCKET/$key.meta" ]; then
				printf '{\n    "ContentLength": %s,\n    "Metadata": {\n        "sha256": "%s"\n    }\n}\n' "$(stat -c %s "$STUB_BUCKET/$key")" "$(cat "$STUB_BUCKET/$key.meta")"
			else
				printf '{\n    "ContentLength": %s,\n    "Metadata": {}\n}\n' "$(stat -c %s "$STUB_BUCKET/$key")"
			fi
			exit 0
		fi
		# The real CLI prints the 404 this way by default and under
		# cli_error_format=legacy; json/text/yaml/table drop the "(404)". The
		# script must pin the format, so the stub honours whatever it sees.
		case "${AWS_CLI_ERROR_FORMAT:-legacy}" in
			legacy|enhanced) echo "An error occurred (404) when calling the HeadObject operation: Not Found" >&2 ;;
			json) printf '{\n    "Code": "404",\n    "Message": "Not Found"\n}\n' >&2 ;;
			*) printf '404\tNot Found\n' >&2 ;;
		esac
		exit 254 ;;
	"s3 cp")
		src=$1; dst=$2; shift 2
		headers=()
		while [ $# -gt 0 ]; do
			case $1 in
				--cache-control|--content-type) headers+=("${1#--}: $2"); shift 2 ;;
				--metadata) meta=$2; shift 2 ;;
				*) echo "stub: unexpected cp argument $1" >&2; exit 99 ;;
			esac
		done
		if [[ "$src" == s3://sirius-releases/* ]]; then
			key=${src#s3://sirius-releases/}
			if [ -n "$(fault_for "$key" "${STUB_GET_FAULT:-}")" ]; then
				echo "download failed: $src to $dst An error occurred (500) when calling the GetObject operation: Internal Error" >&2
				exit 1
			fi
			[ -f "$STUB_BUCKET/$key" ] || { echo "fatal error: An error occurred (404) when calling the HeadObject operation: Key \"$key\" does not exist" >&2; exit 1; }
			cp "$STUB_BUCKET/$key" "$dst"
			echo "download: $src to $dst"
		elif [[ "$dst" == s3://sirius-releases/* ]]; then
			key=${dst#s3://sirius-releases/}
			mkdir -p "$(dirname "$STUB_BUCKET/$key")"
			cp "$src" "$STUB_BUCKET/$key"
			printf '%s\n' "${headers[@]}" >"$STUB_BUCKET/$key.headers"
			rm -f "${STUB_BUCKET:?}/${key:?}.meta"
			[ -z "${meta:-}" ] || printf '%s' "${meta#sha256=}" >"$STUB_BUCKET/$key.meta"
			echo "upload: $src to $dst"
		else
			echo "stub: cp between two local paths" >&2; exit 99
		fi ;;
	*)
		echo "stub: unexpected call: aws $svc $op $*" >&2; exit 99 ;;
esac
STUB

cat >"$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Stub curl: serves https://dl.siriuside.com/<key> from the stub bucket, the way
# the CDN serves the R2 objects. Only the script's `curl -fsSL <url>` is understood.
set -euo pipefail
echo "curl $*" >>"$STUB_LOG"
[ "$1" = -fsSL ] && [ $# = 2 ] || { echo "stub: unexpected curl call: $*" >&2; exit 99; }
key=${2#https://dl.siriuside.com/}
[ "$key" != "$2" ] || { echo "stub: unexpected url $2" >&2; exit 99; }
[ -f "$STUB_BUCKET/$key" ] || exit 22
cat "$STUB_BUCKET/$key"
STUB
chmod +x "$tmp/bin/aws" "$tmp/bin/curl"

# ---- fixtures ---------------------------------------------------------------

# A pacman package is a tar with a .PKGINFO; repo-add reads nothing else, so a
# few bytes stand in for the real 145 MiB one. Different content gives
# different bytes, which the immutable-name check must tell apart.
make_pkg() { # <ver-rel> [content] → path
	local ver=$1 content=${2:-payload} stage
	stage=$(mktemp -d "$tmp/stage.XXXXXX")
	printf 'pkgname = sirius-ide-bin\npkgbase = sirius-ide-bin\npkgver = %s\npkgdesc = self-test\nurl = https://siriuside.com\nbuilddate = 1700000000\npackager = self-test\nsize = 10\narch = x86_64\nlicense = custom\n' "$ver" >"$stage/.PKGINFO"
	printf '%s\n' "$content" >"$stage/payload"
	mkdir -p "$tmp/pkgs/$content"
	bsdtar --format=gnutar -C "$stage" -cf - .PKGINFO payload | zstd -q -f -o "$tmp/pkgs/$content/sirius-ide-bin-$ver-x86_64.pkg.tar.zst"
	echo "$tmp/pkgs/$content/sirius-ide-bin-$ver-x86_64.pkg.tar.zst"
}

# What a previous publish left in the bucket: the package object with its
# sha256 metadata, and the four database objects.
seed_repo() { # <pkg path>
	local pkg=$1 seed
	seed=$(mktemp -d "$tmp/seed.XXXXXX")
	cp "$pkg" "$seed/"
	(cd "$seed" && repo-add --quiet sirius.db.tar.gz "$(basename "$pkg")")
	mkdir -p "$bucket/$prefix"
	cp "$pkg" "$bucket/$prefix/"
	sha256sum "$pkg" | cut -d' ' -f1 | tr -d '\n' >"$bucket/$prefix/$(basename "$pkg").meta"
	for f in db files; do
		cp "$seed/sirius.$f.tar.gz" "$bucket/$prefix/sirius.$f.tar.gz"
		cp "$seed/sirius.$f.tar.gz" "$bucket/$prefix/sirius.$f"
	done
}
unpublish() { # <object name>: take one object out of the stub bucket
	rm -f "${bucket:?}/${prefix:?}/${1:?}"
}

# ---- the harness ------------------------------------------------------------

failures=0
out=; log=

run_script() { # <expected: ok|fail> <script args...>; sets $out and $log
	local expect=$1 rc=0; shift
	out=$tmp/out; log=$tmp/log
	: >"$log"
	PATH="$tmp/bin:$PATH" STUB_LOG=$log STUB_BUCKET=$bucket \
		R2_ENDPOINT=https://stub.r2.test AWS_ACCESS_KEY_ID=test-key AWS_SECRET_ACCESS_KEY=test-secret \
		GITHUB_STEP_SUMMARY=$tmp/summary \
		bash "$script" "$@" >"$out" 2>&1 || rc=$?
	case "$expect:$rc" in
		ok:0) return 0 ;;
		fail:0) fail "expected the script to fail, it exited 0" ;;
		ok:*) fail "expected the script to succeed, it exited $rc" ;;
		fail:*) return 0 ;;
	esac
}

case_name=
begin() { # <name>: a fresh bucket and no fault
	case_name=$1
	rm -rf "${bucket:?}"; mkdir -p "$bucket/$prefix"
	unset STUB_HEAD_FAULT STUB_GET_FAULT
	case_failed=0
}
fail() {
	echo "  FAIL: $*"
	case_failed=1
}
finish() {
	if [ "$case_failed" = 0 ]; then
		echo "ok   $case_name"
	else
		echo "FAIL $case_name — script output:"
		sed 's/^/     | /' "$out"
		echo "     stub calls:"
		sed 's/^/     | /' "$log"
		failures=$((failures + 1))
	fi
}

expect_output() { grep -qE -- "$1" "$out" || fail "output lacks /$1/"; }
expect_no_output() { ! grep -qE -- "$1" "$out" || fail "output has /$1/ and must not"; }
expect_no_upload() { ! grep -q ' s3 cp \./' "$log" || fail "something was uploaded: $(grep ' s3 cp \./' "$log" | tr '\n' ';')"; }
expect_upload_count() { local n; n=$(grep -c ' s3 cp \./' "$log" || true); [ "$n" = "$1" ] || fail "expected $1 uploads, saw $n"; }
expect_no_repo_add() { expect_no_output '^== repo-add'; }
expect_client_db_lists() { # <ver-rel>: sirius.db, the object pacman reads, names exactly this entry
	[ -f "$bucket/$prefix/sirius.db" ] || { fail "no sirius.db in the bucket"; return; }
	local entries; entries=$(tar -tzf "$bucket/$prefix/sirius.db" | grep '/$' | sed 's|/$||' | tr '\n' ' ')
	[ "$entries" = "sirius-ide-bin-$1 " ] || fail "sirius.db lists '$entries', expected sirius-ide-bin-$1"
}
expect_db_lists() { # <ver-rel>: as above, and the four database objects are two identical pairs
	expect_client_db_lists "$1"
	cmp -s "$bucket/$prefix/sirius.db" "$bucket/$prefix/sirius.db.tar.gz" || fail "sirius.db and sirius.db.tar.gz differ"
	cmp -s "$bucket/$prefix/sirius.files" "$bucket/$prefix/sirius.files.tar.gz" || fail "sirius.files and sirius.files.tar.gz differ"
}
expect_headers() { # <key> <regex>
	grep -qE -- "$2" "$bucket/$prefix/$1.headers" || fail "$1 was uploaded with headers '$(tr '\n' ';' <"$bucket/$prefix/$1.headers")', expected /$2/"
}

older=$(make_pkg 1.118.6-1 older)
newer=$(make_pkg 1.118.7-1 newer)
rebuilt=$(make_pkg 1.118.7-1 rebuilt)   # same name as $newer, different bytes
newest=$(make_pkg 1.118.8-1 newest)

# ---- the cases --------------------------------------------------------------

begin "first publish: all four database objects 404"
run_script ok "$newer"
expect_output '^sirius\.db\.tar\.gz: 404'
expect_output '::warning::.*first publish'
expect_upload_count 5
expect_db_lists 1.118.7-1
expect_headers sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst 'cache-control: public, max-age=31536000, immutable'
expect_headers sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst 'content-type: application/zstd'
expect_headers sirius.db 'cache-control: no-cache'
expect_headers sirius.files.tar.gz 'cache-control: no-cache'
[ "$(cat "$bucket/$prefix/sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst.meta")" = "$(sha256sum "$newer" | cut -d' ' -f1)" ] || fail "sha256 metadata not recorded"
# Property 3: the package object is uploaded before any database object.
[ "$(grep -n ' s3 cp \./' "$log" | head -1)" = "$(grep -n ' s3 cp \./sirius-ide-bin' "$log")" ] || fail "a database object went up before the package"
expect_output '^== published sirius-ide-bin-1\.118\.7-1'
finish

begin "upgrade: the live database lists an older version"
seed_repo "$older"
run_script ok "$newer"
expect_output '^fetched sirius\.db\.tar\.gz'
expect_output '^database currently lists sirius-ide-bin-1\.118\.6-1'
expect_no_output '::warning::'
expect_upload_count 5
expect_db_lists 1.118.7-1
finish

begin "downgrade refused: the live database lists a newer version"
seed_repo "$newest"
run_script ok "$newer"
expect_output '::notice::sirius-ide-bin-1\.118\.8-1 is already published and is newer'
expect_no_repo_add
expect_no_upload
expect_db_lists 1.118.8-1
finish

begin "re-run of the published version with the same bytes"
seed_repo "$newer"
run_script ok "$newer"
expect_output 'already the published version; re-verifying'
expect_output 'already in the bucket with the same bytes; not re-uploading'
expect_upload_count 4   # the database objects only
expect_db_lists 1.118.7-1
finish

begin "rebuilt bytes under the published name are refused"
seed_repo "$newer"
run_script fail "$rebuilt"
expect_output '::error::.*already exists in the bucket with different bytes'
expect_output 'arch_pkgrel'
expect_no_upload
cmp -s "$bucket/$prefix/sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst" "$newer" || fail "the published package object was replaced"
finish

begin "a package object without sha256 metadata is hashed, not trusted"
seed_repo "$newer"
unpublish sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst.meta
run_script fail "$rebuilt"
grep -q ' s3 cp s3://sirius-releases/arch/x86_64/sirius-ide-bin-1.118.7-1-x86_64.pkg.tar.zst ' "$log" || fail "the object was not downloaded for hashing"
expect_output '::error::.*already exists in the bucket with different bytes'
expect_no_upload
finish

begin "database HeadObject answers 403: not a first publish"
seed_repo "$older"
export STUB_HEAD_FAULT="sirius.db.tar.gz=403"
run_script fail "$newer"
expect_output '::error::cannot tell whether s3://sirius-releases/arch/x86_64/sirius\.db\.tar\.gz exists .*\(403\)'
expect_no_output 'first publish'
expect_no_repo_add
expect_no_upload
expect_db_lists 1.118.6-1
finish

begin "database HeadObject cannot connect: not a first publish"
seed_repo "$older"
export STUB_HEAD_FAULT="sirius.db.tar.gz=connect"
run_script fail "$newer"
expect_output '::error::cannot tell whether .*Could not connect to the endpoint URL'
expect_no_output 'first publish'
expect_no_repo_add
expect_no_upload
finish

begin "files database HeadObject answers 500: stops before repo-add"
seed_repo "$older"
export STUB_HEAD_FAULT="sirius.files.tar.gz=500"
run_script fail "$newer"
expect_output '::error::cannot tell whether .*sirius\.files\.tar\.gz exists .*\(500\)'
expect_no_repo_add
expect_no_upload
finish

begin "database exists but the download fails"
seed_repo "$older"
export STUB_GET_FAULT="sirius.db.tar.gz"
run_script fail "$newer"
expect_output '::error::sirius\.db\.tar\.gz exists in the bucket but could not be downloaded'
expect_no_repo_add
expect_no_upload
finish

begin "half a repository: db present, files 404"
seed_repo "$older"
unpublish sirius.files.tar.gz
run_script fail "$newer"
expect_output '::error::.*half-finished repository'
expect_no_repo_add
expect_no_upload
finish

begin "half a repository: files present, db 404"
seed_repo "$older"
unpublish sirius.db.tar.gz
run_script fail "$newer"
expect_output '::error::.*half-finished repository'
expect_no_output 'first publish'
expect_no_repo_add
expect_no_upload
finish

begin "half a repository: the objects pacman reads survive, the .tar.gz pair is gone"
seed_repo "$older"
unpublish sirius.db.tar.gz
unpublish sirius.files.tar.gz
run_script fail "$newer"
expect_output '::error::.*has sirius\.db sirius\.files but not sirius\.db\.tar\.gz sirius\.files\.tar\.gz'
expect_no_output 'first publish'
expect_no_repo_add
expect_no_upload
expect_client_db_lists 1.118.6-1   # what clients read is untouched
finish

begin "half a repository: the .tar.gz pair is there, sirius.db is gone"
seed_repo "$older"
unpublish sirius.db
run_script fail "$newer"
expect_output '::error::.*but not sirius\.db —'
expect_no_output 'first publish'
expect_no_repo_add
expect_no_upload
finish

begin "a cli_error_format that would hide the 404 is overridden by the script"
seed_repo "$older"
export AWS_CLI_ERROR_FORMAT=json    # as if ~/.aws/config on the runner said so
run_script ok "$newer"
unset AWS_CLI_ERROR_FORMAT
expect_output '^== package object'
expect_no_output 'cannot tell whether'
expect_upload_count 5
expect_db_lists 1.118.7-1
finish

begin "the fetched database is unreadable"
seed_repo "$older"
echo "not a tarball" >"$bucket/$prefix/sirius.db.tar.gz"
run_script fail "$newer"
expect_output '::error::the fetched sirius\.db\.tar\.gz is not a readable pacman database'
expect_no_repo_add
expect_no_upload
finish

begin "package HeadObject answers 403: the immutable-name check does not assume absence"
seed_repo "$older"
export STUB_HEAD_FAULT="x86_64.pkg.tar.zst=403"
run_script fail "$newer"
expect_output '^== package object'
expect_output '::error::cannot tell whether .*sirius-ide-bin-1\.118\.7-1-x86_64\.pkg\.tar\.zst exists .*\(403\)'
expect_no_upload
expect_db_lists 1.118.6-1
finish

begin "dry run touches neither R2 nor the CDN"
run_script ok "$newer" --dry-run
expect_output '^== dry run complete; nothing uploaded'
[ ! -s "$log" ] || fail "the dry run called the stubs: $(tr '\n' ';' <"$log")"
finish

unset STUB_HEAD_FAULT STUB_GET_FAULT
echo
if [ "$failures" = 0 ]; then
	echo "publish-arch-repo.sh self-test: all cases passed"
else
	echo "::error::publish-arch-repo.sh self-test: $failures case(s) failed"
	exit 1
fi
