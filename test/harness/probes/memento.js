/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The panel's choices against stock VS Code's global state (test/harness/memento.sh):
//   raw  — two writes to an extension's globalState a few milliseconds apart: how often the key
//          reads back the first value after the second write, and how often the second write is
//          lost for good. VS Code sends each write back to the extension host and the memento takes
//          it whole, so an echo of the first write can land after the second (1.145.3 and 1.146.0:
//          at a 1 ms gap, nearly every time, the second write lost). Recorded, not checked: it is
//          VS Code's to fix.
//   kept — the same writes through the panel's Kept (src/panel/kept.ts, compiled to
//          SIRIUS_KEPT_JS): no read through it returns the earlier value, and once it has had
//          time to repair what an echo undid, globalState itself holds the later value.
// Each trial reads the key about every millisecond for 150 ms after the second write, then reads
// what is stored once things have settled (1 s; 4 s through Kept, which checks the stored value
// 0.5, 1.5 and 3 s after a write and writes it again whenever an echo undid it).

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TRIALS = 36;

async function measure(memento, stored, prefix, settleMs) {
	const byGap = {};
	for (let i = 0; i < TRIALS; i++) {
		const key = `${prefix}.${i % 3}`;
		const second = `second-${i}`;
		const gap = i % 6;
		void memento.update(key, `first-${i}`);
		if (gap) { await sleep(gap); }
		const written = memento.update(key, second);
		let stale = 0;
		for (const until = Date.now() + 150; Date.now() < until;) {
			if (memento.get(key) !== second) { stale++; }
			await sleep(1);
		}
		await written;
		await sleep(settleMs);
		const g = byGap[gap] ??= { trials: 0, stale: 0, lost: 0 };
		g.trials++;
		g.stale += stale ? 1 : 0;
		g.lost += stored.get(key) !== second ? 1 : 0;
	}
	const total = Object.values(byGap).reduce((sum, g) => ({ stale: sum.stale + g.stale, lost: sum.lost + g.lost }), { stale: 0, lost: 0 });
	return { ...total, byGap };
}

exports.run = async function (vscode, context) {
	const failures = [];
	const { Kept } = require(process.env.SIRIUS_KEPT_JS);
	const raw = await measure(context.globalState, context.globalState, 'raw', 1000);
	const kept = await measure(new Kept(context.globalState), context.globalState, 'kept', 4000);
	if (kept.stale || kept.lost) {
		failures.push(`kept: through Kept, ${kept.stale} of ${TRIALS} trials read back the earlier value, and in ${kept.lost} globalState kept the earlier value after the repair (${JSON.stringify(kept.byGap)})`);
	}
	return { ok: failures.length === 0, failures, version: vscode.version, raw, kept };
};
