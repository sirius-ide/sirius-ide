#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Install a Sirius release package the way a user would, inside a clean
# container of a distribution INSTALL.md names, and prove the result runs:
#
#   1. the package manager resolves every declared dependency (apt/dnf);
#   2. `sirius --version` reports the version being released;
#   3. every shipped native binary resolves all of its shared libraries, and
#      every native module dlopens under the shipped Electron — for a
#      cross-compiled architecture the only place that ever happens;
#   4. the editor starts under Xvfb, creates its logs and is still alive after
#      a grace period — a window, not just a process;
#   5. the REH server passes its own requirements check, its native modules
#      dlopen under its bundled node, it reports the version, starts, and
#      answers /version with the release commit.
#
# Runs as root in the container. The release workflow drives it; locally:
#
#   docker run --rm -v "$PWD:/w" -w /w -e KIND=deb -e ARCH=x64 -e DIST=dist \
#     -e EXPECTED_VERSION=1.118.6 -e EXPECTED_COMMIT=<sha> debian:12 \
#     bash build/sirius/install-test.sh
#
# KIND           deb | rpm | tarball
# DIST           directory holding the release artifacts (default: dist)
# ARCH           x64 | arm64 (default: x64): the artifact's architecture, which
#                must also be the container's own (checked)
# EXPECTED_VERSION, EXPECTED_COMMIT   what --version and /version must report
# ALLOW_MISSING  'true' makes a missing package a warning instead of a failure
#                (the workflow's allow_missing_packages escape hatch)
# GUI            0 skips the Xvfb launch (default 1)

set -euo pipefail

KIND=${KIND:?KIND=deb|rpm|tarball}
DIST=${DIST:-dist}
ARCH=${ARCH:-x64}
EXPECTED_VERSION=${EXPECTED_VERSION:?}
EXPECTED_COMMIT=${EXPECTED_COMMIT:-}
ALLOW_MISSING=${ALLOW_MISSING:-false}
GUI=${GUI:-1}

DIST=$(readlink -f "$DIST")
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
summary=()
note() { echo "$*"; summary+=("$*"); }
fail() { echo "::error::$*"; exit 1; }

. /etc/os-release
note "distro: $PRETTY_NAME ($(uname -m)), package: $KIND"

# The package file names carry each format's own architecture word.
case "$ARCH" in
	x64)   deb_arch=amd64; rpm_arch=x86_64;  machine=x86_64 ;;
	arm64) deb_arch=arm64; rpm_arch=aarch64; machine=aarch64 ;;
	*) fail "ARCH must be x64 or arm64, got '$ARCH'" ;;
esac
# A mis-wired matrix (an arm64 artifact on an x64 runner, say) would otherwise
# surface two sections later as `sirius: Exec format error`.
[ "$(uname -m)" = "$machine" ] || fail "ARCH=$ARCH expects a $machine container, but this one is $(uname -m)"

# ---------------------------------------------------------------------------
# 1. install
# ---------------------------------------------------------------------------
pkg_file=''
case "$KIND" in
	deb)     pkg_file=$(ls "$DIST"/sirius_*_"$deb_arch".deb 2>/dev/null | head -1 || true) ;;
	rpm)     pkg_file=$(ls "$DIST"/sirius-*."$rpm_arch".rpm 2>/dev/null | head -1 || true) ;;
	tarball) pkg_file=$(ls "$DIST"/sirius-linux-"$ARCH".tar.gz 2>/dev/null | head -1 || true) ;;
	*) fail "KIND must be deb, rpm or tarball" ;;
esac
if [ -z "$pkg_file" ]; then
	if [ "$ALLOW_MISSING" = true ]; then
		echo "::warning::no $KIND package in $DIST; allow_missing_packages is set, so this leg is skipped"
		exit 0
	fi
	fail "no $KIND package in $DIST"
fi
note "package: $(basename "$pkg_file") ($(du -h "$pkg_file" | cut -f1))"

export DEBIAN_FRONTEND=noninteractive
case "$ID" in
	debian|ubuntu)
		apt-get -o Acquire::Retries=3 update -qq
		apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends ca-certificates curl procps >/dev/null
		;;
	rocky|rhel|centos|almalinux|fedora)
		# curl-minimal already provides curl on RHEL 9 images and conflicts
		# with the full curl package, so only add what is missing.
		dnf -y -q install procps-ng >/dev/null
		command -v curl >/dev/null || dnf -y -q install --allowerasing curl >/dev/null
		;;
	*) fail "unsupported distribution $ID" ;;
esac

case "$KIND" in
	deb)
		# apt resolves the dependencies declared in DEBIAN/control from the
		# distribution's own repositories — the point of the test.
		apt-get -o Acquire::Retries=3 install -y -qq "$pkg_file" >/dev/null
		dpkg -s sirius | grep -E '^(Status|Version):'
		app=/usr/share/sirius
		;;
	rpm)
		dnf -y install "$pkg_file"
		rpm -q sirius
		app=/usr/share/sirius
		;;
	tarball)
		# No metadata to resolve deps from: install what the .deb would demand,
		# then extract.
		case "$ID" in
			debian|ubuntu)
				apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends \
					libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
					libcurl4 libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
					libpango-1.0-0 libudev1 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
					libxfixes3 libxkbcommon0 libxkbfile1 libxrandr2 libgssapi-krb5-2 libkrb5-3 xdg-utils >/dev/null
				;;
		esac
		tar -xzf "$pkg_file" -C /opt
		app=/opt/VSCode-linux-$ARCH
		ln -sf "$app/bin/sirius" /usr/local/bin/sirius
		;;
esac
[ -x "$app/sirius" ] || fail "$app/sirius is not there after install"
note "installed to $app"

# ---------------------------------------------------------------------------
# 2. version
# ---------------------------------------------------------------------------
# The launcher refuses to run as root without --user-data-dir; --version is
# answered by the CLI entry point under ELECTRON_RUN_AS_NODE, so no display.
sirius --version --user-data-dir=/tmp/sirius-ud > /tmp/sirius-version.txt
got=$(head -1 /tmp/sirius-version.txt)
[ "$got" = "$EXPECTED_VERSION" ] || fail "sirius --version reported '$got', expected '$EXPECTED_VERSION'"
if [ -n "$EXPECTED_COMMIT" ]; then
	[ "$(sed -n 2p /tmp/sirius-version.txt)" = "$EXPECTED_COMMIT" ] || fail "sirius --version reported commit '$(sed -n 2p /tmp/sirius-version.txt)', expected $EXPECTED_COMMIT"
fi
note "sirius --version: $(tr '\n' ' ' < /tmp/sirius-version.txt)"

# ---------------------------------------------------------------------------
# 3. linkage
# ---------------------------------------------------------------------------
missing=0
checked=0
while IFS= read -r f; do
	[ -f "$f" ] || continue
	checked=$((checked + 1))
	# Capture first. ldd exits 0 with 'not found' lines for a missing library
	# and non-zero ('not a dynamic executable') for a binary of another
	# architecture — which a `| grep 'not found'` pipeline waved through.
	if ! out=$(ldd "$f" 2>&1); then
		echo "::error::$f: ldd cannot load it on $(uname -m): $(printf '%s' "$out" | tr -s ' ' | tr '\n' ';')"
		missing=1
	else
		case "$out" in
			*'not found'*)
				echo "::error::$f: $(printf '%s\n' "$out" | grep 'not found' | tr -s ' ' | tr '\n' ';')"
				missing=1
				;;
		esac
	fi
done < <(printf '%s\n' "$app/sirius" "$app/chrome-sandbox" "$app/chrome_crashpad_handler"; \
	find "$app/resources/app/node_modules" -name '*.node' -not -path '*/obj.target/*' \
		| grep -vE 'windows-foreground-love|deviceid/build/Release/windows\.node|win32-|-msvc-')
[ "$checked" -ge 8 ] || fail "only $checked binaries inspected; the install looks incomplete"
deferred=''
if [ "$missing" != 0 ]; then
	if [ "$KIND" = tarball ]; then
		# The tarball has no dependency metadata to blame; record it, keep going
		# so the server section is measured too, and fail at the end.
		note "linkage: FAILED — a shipped binary needs a library that is not installed (see errors above)"
		deferred='linkage'
	else
		fail "a shipped binary needs a library the package does not pull in"
	fi
else
	note "linkage: $checked binaries resolve every shared library"
fi

# ---------------------------------------------------------------------------
# 3b. every native module loads
# ---------------------------------------------------------------------------
# ldd proves the libraries resolve; dlopen under the shipped Electron proves
# the module itself loads. The editor below opens only what startup needs
# (node-pty, kerberos and the watcher wait for a terminal, a proxy, a
# workspace), so every .node is opened here — and for a cross-compiled
# architecture this is the only place that ever happens.
(cd "$app" && ELECTRON_RUN_AS_NODE=1 ./sirius "$here/dlopen-smoke.cjs" resources/app/node_modules 7) \
	|| fail "a native module does not load under the shipped Electron (see above)"
note "dlopen: every native module loads under the shipped Electron"

# ---------------------------------------------------------------------------
# 4. a real window under Xvfb
# ---------------------------------------------------------------------------
if [ "$GUI" = 1 ]; then
	case "$ID" in
		debian|ubuntu) apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends xvfb xauth >/dev/null ;;
		*)             dnf -y -q install xorg-x11-server-Xvfb xorg-x11-xauth >/dev/null ;;
	esac
	rm -rf /tmp/sirius-gui /tmp/sirius-ext
	mkdir -p /tmp/sirius-gui
	echo 'hello from the install test' > /tmp/sirius-gui/hello.txt
	# The Electron binary directly (as the .desktop entry runs it), in the
	# foreground, for a fixed grace period. Exit 124 means timeout(1) had to
	# kill a process that was still running: it did not crash, did not exit,
	# and had time to create a window. Anything else is a failure.
	set +e
	timeout -s TERM 60 xvfb-run -a -s '-screen 0 1280x800x24' \
		"$app/sirius" --no-sandbox --disable-gpu --disable-dev-shm-usage \
		--user-data-dir=/tmp/sirius-gui --extensions-dir=/tmp/sirius-ext \
		--verbose /tmp/sirius-gui/hello.txt > /tmp/sirius-launch.log 2>&1
	rc=$?
	set -e
	if [ "$rc" != 124 ]; then
		echo "--- launch log (last 60 lines) ---"; tail -60 /tmp/sirius-launch.log
		fail "the editor exited with code $rc within the grace period instead of staying up"
	fi
	main_log=$(find /tmp/sirius-gui/logs -name main.log 2>/dev/null | head -1 || true)
	if [ -z "$main_log" ]; then
		echo "--- launch log (last 80 lines) ---"; tail -80 /tmp/sirius-launch.log
		echo "--- files under logs ---"; find /tmp/sirius-gui/logs 2>/dev/null | head -40
		fail "no main.log under /tmp/sirius-gui/logs: the main process never got going"
	fi
	# 'FATAL: ... Failed to shutdown' is Electron's own reaction to the SIGTERM
	# timeout(1) sends at the end of the grace period, not a crash.
	crash='Segmentation fault|core dumped|FATAL:|renderer process gone|GPU process isn.t usable|Failed to load|window.*crashed'
	if grep -iE "$crash" /tmp/sirius-launch.log "$main_log" | grep -qv 'Failed to shutdown'; then
		echo "--- matching lines ---"; grep -iE "$crash" /tmp/sirius-launch.log "$main_log" | grep -v 'Failed to shutdown' | head -20
		echo "--- launch log (last 60 lines) ---"; tail -60 /tmp/sirius-launch.log
		fail "the logs show a crashed process"
	fi
	# The workbench writes window<N>/renderer.log as soon as a window is up, so
	# its absence means the main process idled without ever showing a window.
	renderer_log=$(find /tmp/sirius-gui/logs -name renderer.log 2>/dev/null | head -1 || true)
	if [ -z "$renderer_log" ]; then
		echo "--- log files ---"; find /tmp/sirius-gui/logs -type f
		echo "--- main.log (last 40 lines) ---"; tail -40 "$main_log"
		fail "no renderer.log: the window never came up"
	fi
	note "gui: window up (renderer.log written), still running after 60 s"
fi

# ---------------------------------------------------------------------------
# 5. the REH server
# ---------------------------------------------------------------------------
server_tar=$DIST/sirius-server-linux-$ARCH.tar.gz
if [ -f "$server_tar" ]; then
	rm -rf /tmp/sirius-server && mkdir -p /tmp/sirius-server
	tar -xzf "$server_tar" -C /tmp/sirius-server --strip-components 1
	S=/tmp/sirius-server
	[ -x "$S/bin/sirius-server" ] || fail "server tarball has no bin/sirius-server"
	"$S/bin/helpers/check-requirements.sh" || fail "the server's own requirements check refused this host (exit $?)"
	"$S/node" "$here/dlopen-smoke.cjs" "$S/node_modules" 5 || fail "a server native module does not load under the bundled node (see above)"
	# sed, not head: under pipefail a head that exits first can leave the
	# writer with SIGPIPE and turn a passing leg red.
	sv=$("$S/bin/sirius-server" --version | sed -n 1p)
	[ "$sv" = "$EXPECTED_VERSION" ] || fail "sirius-server --version reported '$sv', expected '$EXPECTED_VERSION'"
	port=8317
	"$S/bin/sirius-server" --host 127.0.0.1 --port $port --accept-server-license-terms --without-connection-token \
		--server-data-dir /tmp/sirius-server-data > /tmp/sirius-server.log 2>&1 &
	spid=$!
	got=''
	for _ in $(seq 1 45); do
		got=$(curl -s "http://127.0.0.1:$port/version" || true)
		[ -n "$got" ] && break
		kill -0 $spid 2>/dev/null || break
		sleep 1
	done
	kill $spid 2>/dev/null || true
	wait $spid 2>/dev/null || true
	if [ -z "$got" ]; then
		echo "--- server log ---"; tail -40 /tmp/sirius-server.log
		fail "the server never answered /version"
	fi
	if [ -n "$EXPECTED_COMMIT" ] && [ "$got" != "$EXPECTED_COMMIT" ]; then
		fail "/version answered '$got', expected $EXPECTED_COMMIT"
	fi
	note "server: requirements ok, native modules load, --version $sv, /version answered ($got)"
else
	note "server: no sirius-server-linux-$ARCH.tar.gz in $DIST, skipped"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
	{
		echo "### Install test: $PRETTY_NAME $ARCH, $KIND"
		echo
		for line in "${summary[@]}"; do echo "- $line"; done
	} >> "$GITHUB_STEP_SUMMARY"
fi
if [ -n "$deferred" ]; then
	echo "::error::install test failed on: $deferred (see above)"
	exit 1
fi
echo "== install test passed"
