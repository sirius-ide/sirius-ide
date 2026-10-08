/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// "Get started with Sirius": every button and completion event names a real command or
// setting, every picture ships, the walkthrough opened itself on this first start, and its
// Tab-completion button turns completion on. What a page looks like is
// test/harness/first-launch.sh's job; this checks what the extension host can see.

const fs = require('fs');
const path = require('path');

const WALKTHROUGH = 'sirius.sirius-ai#gettingStarted';

exports.run = async function (vscode) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };

	const ext = vscode.extensions.getExtension('sirius.sirius-ai');
	await ext.activate();
	const walkthroughs = ext.packageJSON.contributes.walkthroughs ?? [];
	const walkthrough = walkthroughs.find(w => w.id === 'gettingStarted');
	check(walkthrough, 'no walkthrough "gettingStarted" in the manifest');
	if (!walkthrough) {
		return { ok: false, failures };
	}

	const commands = new Set(await vscode.commands.getCommands(true));
	const config = vscode.workspace.getConfiguration();
	const exists = file => fs.existsSync(path.join(ext.extensionPath, file));
	const steps = [];

	check(exists(walkthrough.icon), `icon ${walkthrough.icon} missing`);
	for (const step of walkthrough.steps) {
		const links = [...step.description.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]);
		for (const link of links) {
			if (link.startsWith('command:')) {
				const id = decodeURIComponent(link.slice('command:'.length).split('?')[0]).replace(/^toSide:/, '');
				check(commands.has(id), `${step.id}: button runs unknown command ${id}`);
			} else {
				check(link.startsWith('https://siriuside.com/'), `${step.id}: link ${link} leaves siriuside.com`);
			}
		}
		for (const event of step.completionEvents ?? []) {
			const [kind, arg] = [event.slice(0, event.indexOf(':')), event.slice(event.indexOf(':') + 1)];
			if (kind === 'onCommand') {
				check(commands.has(arg), `${step.id}: completes on unknown command ${arg}`);
			} else if (kind === 'onSettingChanged') {
				check(config.inspect(arg)?.defaultValue !== undefined, `${step.id}: completes on unknown setting ${arg}`);
			} else if (kind === 'onLink') {
				check(links.includes(arg), `${step.id}: completes on a link it does not show: ${arg}`);
			} else {
				check(kind === 'onContext' && arg === 'sirius.ai.modelAvailable', `${step.id}: unexpected completion event ${event}`);
			}
		}
		const pictures = Object.values(step.media.image ?? {});
		check(pictures.length === 4 && pictures.every(exists), `${step.id}: a picture is missing`);
		check(Boolean(step.media.altText), `${step.id}: no alt text`);
		steps.push({ id: step.id, title: step.title, links, completionEvents: step.completionEvents ?? '(from its buttons)' });
	}

	// It opened itself: the first start of a profile shows it without anyone asking. run.sh
	// passes --skip-welcome, which turns upstream's startup page off, so a Welcome-page tab can
	// only have come from sirius-ai. The tab reads "Welcome", or "Walkthrough: Sirius AI" once
	// the page has taken its title — which category it shows is first-launch.sh's to see.
	const tabLabels = () => vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label));
	const isWelcomeTab = label => label === 'Welcome' || label.startsWith('Walkthrough:');
	const openedOnFirstStart = tabLabels().some(isWelcomeTab);
	check(openedOnFirstStart, `the walkthrough did not open on the first start (tabs: ${tabLabels().join(', ') || 'none'})`);

	// The button the Tab-completion step offers.
	const before = config.inspect('sirius.ai.enable')?.globalValue;
	await vscode.commands.executeCommand('sirius.ai.enableTabCompletion');
	const after = vscode.workspace.getConfiguration().inspect('sirius.ai.enable')?.globalValue;
	check(after?.['*'] === true, `sirius.ai.enableTabCompletion left sirius.ai.enable at ${JSON.stringify(after)}`);

	// And it can be reopened by id, the way the Welcome page and "Open Walkthrough..." do.
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH, false);
	await new Promise(resolve => setTimeout(resolve, 1500));
	const reopened = tabLabels().some(isWelcomeTab);
	check(reopened, `openWalkthrough ${WALKTHROUGH} opened no walkthrough tab (tabs: ${tabLabels().join(', ') || 'none'})`);

	return {
		ok: failures.length === 0,
		failures,
		openedOnFirstStart,
		reopened,
		tabCompletion: { before: before ?? null, after },
		steps,
	};
};
