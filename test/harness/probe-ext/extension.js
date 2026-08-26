/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generic verification probe: runs the script named by SIRIUS_PROBE_SCRIPT
// inside a live extension host, then writes its JSON result (or the failure)
// to SIRIUS_PROBE_OUT. The harness owns launch and teardown; probes stay tiny.

const vscode = require('vscode');
const fs = require('fs');

async function activate(context) {
	const script = process.env.SIRIUS_PROBE_SCRIPT;
	const out = process.env.SIRIUS_PROBE_OUT;
	if (!script || !out) {
		return;
	}
	await new Promise(resolve => setTimeout(resolve, 12000));
	try {
		const result = await require(script).run(vscode, context);
		fs.writeFileSync(out, JSON.stringify({ ok: true, result }, null, 1));
	} catch (error) {
		fs.writeFileSync(out, JSON.stringify({ ok: false, error: String(error && error.message || error) }));
	}
}

module.exports = { activate, deactivate() { } };
