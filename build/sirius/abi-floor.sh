#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Fail the build if any binary we ship needs a newer glibc / libstdc++ than the
# oldest distro INSTALL.md targets (RHEL/Rocky 9 = glibc 2.34, Ubuntu 22.04 =
# 2.35, Debian 12 = 2.36).
#
#   APP_DIR=../VSCode-linux-x64 MAX_GLIBC=2.28 MAX_GLIBCXX=none bash build/sirius/abi-floor.sh
#   APP_DIR=../sirius-server-linux-x64 LAYOUT=server MAX_GLIBC=2.28 MAX_GLIBCXX=3.4.25 bash build/sirius/abi-floor.sh
#
# Invoke through `bash`, not by path: the gate must not depend on an exec bit
# surviving whatever applied the commit.
#
# The file set deliberately mirrors build/linux/dependencies-generator.ts
# (resources/app/node_modules/**/*.node plus the launcher, chrome-sandbox and
# chrome_crashpad_handler), so a pass here means the deb/rpm dependency
# comparison downstream cannot be surprised. Anything outside that set — notably
# extensions/microsoft-authentication/dist/msal-node-runtime.node, a third-party
# prebuilt that links libstdc++ — is invisible to the packages too, so widening
# the scope would only produce a failure nobody can fix.
#
# MAX_GLIBCXX=none means "must not link libstdc++ at all", which is the real x64
# expectation: the amd64/x86_64 reference dep-lists contain zero libstdc++
# entries because x64 is built with clang and a statically linked libc++. That
# is checked on DT_NEEDED, not only on versioned GLIBCXX_ symbols — five of the
# thirteen modules in a runner-gcc build link libstdc++.so.6 without referencing
# a single versioned symbol, and a symbol-only check waved them through.
#
# LAYOUT=server checks the REH server tarball instead: its native modules live
# in node_modules/ at the root and the runtime is the bundled `node` binary,
# not Electron. The server is compiled with the gcc sysroot rather than clang
# and libc++, so it does link libstdc++ — cap it at the version its own
# bin/helpers/check-requirements.sh promises remote hosts.

set -uo pipefail

APP_DIR=${APP_DIR:?set APP_DIR to the built app directory, e.g. ../VSCode-linux-x64}
APP_NAME=${APP_NAME:-sirius}
MAX_GLIBC=${MAX_GLIBC:-2.28}
MAX_GLIBCXX=${MAX_GLIBCXX:-none}
LAYOUT=${LAYOUT:-client}

newer() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" != "$2" ]; }

fail=0
checked=0

case "$LAYOUT" in
	client)
		files=$(find "$APP_DIR/resources/app/node_modules" -name '*.node' 2>/dev/null)
		files="$files
$APP_DIR/$APP_NAME
$APP_DIR/chrome-sandbox
$APP_DIR/chrome_crashpad_handler"
		;;
	server)
		files=$(find "$APP_DIR/node_modules" -name '*.node' 2>/dev/null)
		files="$files
$APP_DIR/node"
		;;
	*)
		echo "::error::abi-floor: LAYOUT must be client or server, got '$LAYOUT'"
		exit 1
		;;
esac

while IFS= read -r f; do
	[ -n "$f" ] && [ -f "$f" ] || continue
	syms=$(objdump -T "$f" 2>/dev/null) || continue
	checked=$((checked + 1))
	rel=${f#"$APP_DIR/"}
	g=$(printf '%s\n' "$syms" | grep -o 'GLIBC_[0-9][0-9.]*'   | sed 's/GLIBC_//'   | sort -V | tail -1)
	x=$(printf '%s\n' "$syms" | grep -o 'GLIBCXX_[0-9][0-9.]*' | sed 's/GLIBCXX_//' | sort -V | tail -1)
	needs_cxx=$(objdump -p "$f" 2>/dev/null | grep -c 'NEEDED.*libstdc++')
	if [ -n "$g" ] && newer "$g" "$MAX_GLIBC"; then
		echo "::error::$rel needs GLIBC_$g (cap $MAX_GLIBC)"
		fail=1
	fi
	if [ "$MAX_GLIBCXX" = none ]; then
		if [ "$needs_cxx" -gt 0 ]; then
			echo "::error::$rel links libstdc++.so.6 (DT_NEEDED${x:+, GLIBCXX_$x}); this arch must be libc++-only"
			fail=1
		fi
	elif [ -n "$x" ] && newer "$x" "$MAX_GLIBCXX"; then
		echo "::error::$rel needs GLIBCXX_$x (cap $MAX_GLIBCXX)"
		fail=1
	fi
done <<< "$files"

if [ "$checked" -lt 5 ]; then
	echo "::error::abi-floor: only $checked binaries inspected under $APP_DIR — wrong APP_DIR, or the build is incomplete"
	exit 1
fi

if [ "$fail" = 0 ]; then
	echo "ABI floor OK across $checked $LAYOUT binaries: glibc <= $MAX_GLIBC, libstdc++ <= $MAX_GLIBCXX"
fi
exit $fail
