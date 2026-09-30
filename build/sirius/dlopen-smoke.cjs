/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// dlopen every native module under a directory with the runtime that loads it in
// production — Electron under ELECTRON_RUN_AS_NODE for the client, the bundled
// node for the server. The .node files themselves, not the package entry points,
// which lazily load and swallow errors:
//
//   ELECTRON_RUN_AS_NODE=1 ./sirius build/sirius/dlopen-smoke.cjs resources/app/node_modules 7
//   ./node build/sirius/dlopen-smoke.cjs node_modules 5
//
// Exit 1 if any module fails to load, or if fewer than MIN load (a wrong directory
// would otherwise pass vacuously). The release workflow runs this on the runner
// where the build's architecture is the runner's, and build/sirius/install-test.sh
// runs it inside every install-test container on the installed tree — for a
// cross-compiled architecture that is the only place the modules are ever opened.
//
// .cjs on purpose: the repository's package.json is "type": "module", and this has
// to run as plain CommonJS under whichever runtime from whichever cwd.
'use strict';
const fs = require('fs');
const path = require('path');

const [dirArg, minArg] = process.argv.slice(2);
if (!dirArg) {
	console.error('usage: dlopen-smoke.cjs <dir-with-node-modules> [min-loaded]');
	process.exit(2);
}
const dir = path.resolve(dirArg);
const min = Number(minArg || 1);
// Windows-only modules that ship in the Linux tree; the same list as install-test.sh.
const windowsOnly = /windows-foreground-love|deviceid[\\/]build[\\/]Release[\\/]windows\.node|win32-|-msvc-/;

function* walk(d) {
	for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'obj.target') {
				yield* walk(p);
			}
		} else if (entry.isFile() && entry.name.endsWith('.node')) {
			yield p;
		}
	}
}

let ok = 0;
let bad = 0;
for (const f of walk(dir)) {
	const rel = path.relative(dir, f);
	if (windowsOnly.test(rel)) {
		console.log('skip ' + rel);
		continue;
	}
	try {
		process.dlopen({ exports: {} }, f);
		ok++;
		console.log('ok   ' + rel);
	} catch (e) {
		bad++;
		console.log('FAIL ' + rel + ' :: ' + String(e && e.message || e).split('\n')[0]);
	}
}
const runtime = process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.versions.node;
console.log(`${ok} loaded, ${bad} failed (${runtime}, ${process.platform}-${process.arch})`);
if (ok < min) {
	console.log(`::error::expected at least ${min} native modules to load under ${dir}, got ${ok}`);
	process.exit(1);
}
process.exit(bad ? 1 : 0);
