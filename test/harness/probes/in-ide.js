/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The VS Code edition where Sirius IDE's built-in Sirius (sirius.sirius-ai) already is. Two runs:
//   in Sirius IDE  — VS Code's own engine check refuses it: Sirius IDE's version (1.118.x) is below
//                    the edition's floor (^1.145.0), so the edition is not loaded at all.
//                      test/harness/vscode-run.sh <sirius-app> extensions/sirius-ai/dist/edition \
//                        test/harness/probes/in-ide.js <out.json>
//   in stock VS Code with a stand-in for the built-in (fake-sirius-ide) — the edition is loaded and
//                    stands aside: its panel says why it is empty, a command says the same and
//                    changes nothing (Turn On Tab Completion leaves the setting alone), and no Tab
//                    item or commit button of its own is there.
//                      SIRIUS_PROBE_EXTRA_EXT=test/harness/fake-sirius-ide test/harness/vscode-run.sh \
//                        <vscode-dir> extensions/sirius-ai/dist/edition test/harness/probes/in-ide.js <out.json>
// Build the edition first (node extensions/sirius-ai/esbuild-edition.mts).

const path = require('path');
const { connectWebview, connectWindow } = require(path.join(__dirname, '..', 'cdp-window.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const EDITION = 'siriuside.sirius-ai';
const BUILT_IN = 'sirius.sirius-ai';

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const edition = vscode.extensions.getExtension(EDITION);
	const builtIn = vscode.extensions.getExtension(BUILT_IN);
	const result = { app: vscode.env.appName, version: vscode.version, builtIn: !!builtIn, edition: edition ? { active: edition.isActive } : null };
	if (/Sirius/.test(vscode.env.appName)) {
		check(!edition, `in Sirius IDE: the edition was loaded (${JSON.stringify(result.edition)})`);
		return { ok: failures.length === 0, failures, ...result };
	}
	check(result.builtIn, 'the stand-in for the built-in is not loaded: run with SIRIUS_PROBE_EXTRA_EXT=test/harness/fake-sirius-ide');
	for (let i = 0; i < 40 && edition && !edition.isActive; i++) { await sleep(250); }
	result.edition = edition ? { active: edition.isActive } : null;
	const win = await connectWindow(vscode.env.appRoot);
	await vscode.commands.executeCommand('sirius.panel.newConversation').then(undefined, () => undefined);
	await vscode.commands.executeCommand('sirius.panel.focus').then(undefined, () => undefined);
	const panel = await connectWebview(EDITION, 'webviewView', 15000).catch(error => ({ failed: String(error) }));
	result.panelText = panel.failed ? panel.failed : await panel.evaluate('document.body.textContent');
	const before = vscode.workspace.getConfiguration().inspect('sirius.completions.enable')?.globalValue;
	await vscode.commands.executeCommand('sirius.completions.turnOn');
	await sleep(1000);
	result.enableAfter = vscode.workspace.getConfiguration().inspect('sirius.completions.enable')?.globalValue ?? null;
	result.toasts = await win.evaluate(`[...document.querySelectorAll('.notification-list-item-message')].map(n => n.textContent)`);
	result.tabItem = await win.evaluate(`!![...document.querySelectorAll('.statusbar-item')].find(x => /sirius\\.completions$/.test(x.id))`);
	check(result.edition?.active === true, `the edition did not start (${JSON.stringify(result.edition)})`);
	check(/Sirius IDE has Sirius built in/.test(result.panelText ?? ''), `the panel does not say why it is empty (${JSON.stringify(result.panelText)})`);
	check(before === undefined && result.enableAfter === null && result.toasts.some(t => /Sirius IDE has Sirius built in/.test(t)), `Turn On Tab Completion changed the setting, or did not say why it does nothing (${JSON.stringify({ enableAfter: result.enableAfter, toasts: result.toasts })})`);
	check(!result.tabItem, 'the Tab item is in the status bar');
	if (!panel.failed) { panel.close(); }
	win.close();
	return { ok: failures.length === 0, failures, ...result };
};
