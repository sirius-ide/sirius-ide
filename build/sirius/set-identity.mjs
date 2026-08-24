/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — rewrite the project's identity in one pass
 *  Copyright (c) emrys. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * The GitHub owner and the update host appear in about thirty places across
 * product.json, both AUR packages, the update worker and the docs. Editing them
 * by hand reliably misses one, and a missed updateUrl is compiled into a release
 * before anyone notices.
 *
 *   node build/sirius/set-identity.mjs --owner sirius-ide --domain sirius.sh
 *
 * Pass --dry to see what would change without writing.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const read = flag => {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
};

const owner = read('--owner');
const domain = read('--domain');
const dry = args.includes('--dry');

if (!owner) {
	console.error('usage: set-identity.mjs --owner <github-owner> [--domain <example.sh>] [--dry]');
	process.exit(1);
}

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const AUR_ROOT = path.resolve(REPO_ROOT, '../aur');

const OLD_OWNER = 'ArshadSiddiqui';
const OLD_UPDATE_HOST = 'update.sirius-ide.dev';

const targets = [
	'product.json',
	'README.md',
	'INSTALL.md',
	'PRIVACY.md',
	'ROADMAP.md',
	'build/update-server/worker.mjs',
	'build/update-server/README.md',
	'resources/linux/code.appdata.xml',
	'resources/linux/debian/control.template',
	'resources/linux/rpm/code.spec.template',
	'.github/workflows/sirius-release.yml'
].map(p => path.join(REPO_ROOT, p));

for (const pkg of ['sirius-ide-bin', 'sirius-ide-git']) {
	const file = path.join(AUR_ROOT, pkg, 'PKGBUILD');
	if (fs.existsSync(file)) {
		targets.push(file);
	}
}

let changedFiles = 0;
let changedLines = 0;

for (const file of targets) {
	if (!fs.existsSync(file)) {
		console.warn(`  skipped (missing): ${path.relative(REPO_ROOT, file)}`);
		continue;
	}

	const before = fs.readFileSync(file, 'utf8');
	let after = before.replaceAll(OLD_OWNER, owner);

	if (domain) {
		after = after.replaceAll(OLD_UPDATE_HOST, `update.${domain}`);
	}

	if (after === before) {
		continue;
	}

	const hits = before.split('\n').filter((line, i) => line !== after.split('\n')[i]).length;
	changedFiles++;
	changedLines += hits;
	console.log(`  ${path.relative(REPO_ROOT, file) || file}  (${hits} lines)`);

	if (!dry) {
		fs.writeFileSync(file, after);
	}
}

console.log(`\n${dry ? 'would change' : 'changed'} ${changedLines} lines across ${changedFiles} files`);

if (domain && !dry) {
	console.log(`\nupdateUrl is now https://update.${domain} — it is compiled into the`);
	console.log('binary, so tag a new release after this or shipped builds keep the old host.');
}
