/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A probe's result as a verdict, for a run nobody watches (CI):
//   node test/harness/verdict.js <result.json> [more.json …]
// Prints what each result says — passed, or every failed check — and exits 1 unless all passed.
// A probe that could not finish (`ok: false` with its error), one whose checks failed
// (`result.ok` false, `result.failures`), and a file that is missing or is not a result all fail.
// In GitHub Actions the verdict also goes to the job's summary.

const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
	console.error('usage: node test/harness/verdict.js <result.json> [more.json …]');
	process.exit(2);
}

const lines = [];
let failed = false;
for (const file of files) {
	const problems = [];
	try {
		const run = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (run.ok !== true) {
			problems.push(`the probe did not finish: ${run.error ?? 'no error given'}`);
		} else if (typeof run.result?.ok !== 'boolean' || !Array.isArray(run.result.failures)) {
			problems.push('the result carries no verdict (no result.ok and result.failures)');
		} else if (!run.result.ok || run.result.failures.length) {
			problems.push(...(run.result.failures.length ? run.result.failures : ['result.ok is false, with no failure named']).map(String));
		}
	} catch (error) {
		problems.push(`no result to read: ${error.message}`);
	}
	failed ||= problems.length > 0;
	lines.push(problems.length ? `FAILED ${file} — ${problems.length} check${problems.length === 1 ? '' : 's'}` : `passed ${file}`, ...problems.map(problem => `  - ${problem}`));
}

console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
	fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map(line => line.startsWith('  - ') ? line.slice(2) : `**${line}**`).join('\n')}\n`);
}
process.exit(failed ? 1 : 0);
