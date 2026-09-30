#!/usr/bin/env bash
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Every ELF file under the given directories must be built for ARCH. This is
# the check that catches a host-architecture binary copied into a
# cross-compiled tree — the class of bug the ABI floor cannot see, because it
# only inspects the modules the package dependency lists are generated from,
# and a wrong-architecture file resolves no symbols there at all.
#
#   ARCH=arm64 bash build/sirius/elf-arch.sh ../VSCode-linux-arm64 ../sirius-server-linux-arm64
#
# EXEMPT is a regex of paths allowed to be another architecture. The default
# covers the sandbox runtime's seccomp helpers, which ship a copy per
# architecture by design; extend it only for a file that is chosen at run time
# by architecture the same way, never for a build mistake.

set -uo pipefail

ARCH=${ARCH:?set ARCH to x64 or arm64}
EXEMPT=${EXEMPT:-'/vendor/seccomp/(x64|arm64)/apply-seccomp$'}

case "$ARCH" in
	x64)   want='x86-64' ;;
	arm64) want='ARM aarch64' ;;
	*) echo "::error::elf-arch: ARCH must be x64 or arm64, got '$ARCH'"; exit 1 ;;
esac
[ "$#" -ge 1 ] || { echo "::error::elf-arch: pass at least one directory"; exit 1; }

fail=0
elves=0
for dir in "$@"; do
	[ -d "$dir" ] || { echo "::error::elf-arch: $dir is not a directory"; exit 1; }
	# `file` in batches, not one process per file: the client tree has tens of
	# thousands of files. Only the ELF lines matter; the architecture is the
	# token after the object kind, e.g. "ELF 64-bit LSB pie executable, x86-64, ...".
	while IFS= read -r line; do
		f=${line%%: ELF *}
		desc=${line#*: ELF }
		elves=$((elves + 1))
		case "$desc" in
			*"$want"*) ;;
			*)
				if [[ "$f" =~ $EXEMPT ]]; then
					echo "exempt ${f#"$dir/"}: ELF $desc"
				else
					echo "::error::${f#"$dir/"} is not $ARCH: ELF $desc"
					fail=1
				fi
				;;
		esac
	done < <(find "$dir" -type f -print0 | xargs -0 -r file -N -- | grep ': ELF ')
done

if [ "$elves" -lt 10 ]; then
	echo "::error::elf-arch: only $elves ELF files under $* — wrong directory, or the build is incomplete"
	exit 1
fi
[ "$fail" = 0 ] && echo "ELF architecture OK: $elves ELF files under $* are $want"
exit $fail
