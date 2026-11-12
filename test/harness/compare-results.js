/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Two runs of the regression set (regress.sh), probe by probe and field by field, timings and
// generated ids left out: what differs, with both values.
//
//   node test/harness/compare-results.js <out-dir-a> <out-dir-b>

const fs = require('fs');
const path = require('path');

const [a, b] = process.argv.slice(2);
const flat = (value, at = '', out = {}) => {
	if (value && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flat(child, at ? `${at}.${key}` : key, out);
		}
	} else {
		out[at] = value;
	}
	return out;
};
const noise = /(^|\.)(ms|closeMs|heldMs|startedAt|answeredAt|releasedAt|at|elapsed|duration|took|seconds)$|callId|\.n$|prompted-\d+|time/i;
const load = (dir, file) => {
	try {
		const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
		return r.result ?? r;
	} catch (error) {
		return { unreadable: String(error) };
	}
};
for (const file of fs.readdirSync(a).filter(f => f.endsWith('.json') && !f.includes('partial'))) {
	const x = flat(load(a, file));
	const y = flat(load(b, file));
	const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(key => !noise.test(key));
	const differ = keys.filter(key => JSON.stringify(x[key]) !== JSON.stringify(y[key]));
	console.log(`${file}: ${differ.length ? `${differ.length} differ` : 'same'}`);
	for (const key of differ.slice(0, 12)) {
		console.log(`   ${key}: ${JSON.stringify(x[key])?.slice(0, 110)}  →  ${JSON.stringify(y[key])?.slice(0, 110)}`);
	}
}
