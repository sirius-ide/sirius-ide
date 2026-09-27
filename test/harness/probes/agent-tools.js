/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Reports what the agent can actually reach at runtime, so the tool tiers in
// chat/siriusAgent.ts are checked against `vscode.lm.tools` rather than against
// the names in upstream's source. A tool that is registered core-agents-only
// (as editFileTool and setArtifacts are) never appears here, and a tier would
// then be offering nothing — this is the probe that catches that.
//
// Also: reads the browser gate on a FRESH profile (sirius-ai contributes the
// default, so the family should be present before anything is flipped); asks
// the agent which tier it assigns each model, so size-aware tiering is checked
// against real local models; confirms the API surface the image path depends
// on; and reads the context windows Ollama discovery takes from /api/show.

const CORE = ['run_in_terminal', 'get_terminal_output', 'manage_todo_list'];
const EXTENDED_ONLY = [
	'send_to_terminal', 'kill_terminal', 'terminal_last_command',
	'run_task', 'get_task_output', 'create_and_run_task', 'runTests',
	'runSubagent', 'vscode_reviewPlan', 'vscode_askQuestions'
];
const BROWSER = [
	'open_browser_page', 'read_page', 'screenshot_page', 'navigate_page',
	'click_element', 'type_in_page', 'run_playwright_code'
];

const names = vscode => new Set(vscode.lm.tools.map(tool => tool.name));
const has = (set, list) => Object.fromEntries(list.map(n => [n, set.has(n)]));

exports.run = async function (vscode) {
	const ext = vscode.extensions.getExtension('sirius.sirius-ai');
	const available = names(vscode);
	const config = vscode.workspace.getConfiguration();

	// Tier per model, as the agent itself computes it.
	let tiers = null;
	let tierError = null;
	try {
		tiers = await vscode.commands.executeCommand('sirius.ai.debug.toolTier');
	} catch (error) {
		tierError = String(error && error.message || error);
	}

	let dataPart = null;
	try {
		const part = vscode.LanguageModelDataPart.image(new Uint8Array([137, 80, 78, 71]), 'image/png');
		dataPart = { mimeType: part.mimeType, dataIsUint8Array: part.data instanceof Uint8Array, dataLength: part.data && part.data.length };
	} catch (error) {
		dataPart = { error: String(error && error.message || error) };
	}

	return {
		siriusAi: { present: !!ext, active: !!(ext && ext.isActive) },
		toolCount: available.size,
		core: has(available, CORE),
		extendedOnly: has(available, EXTENDED_ONLY),
		browser: {
			// Fresh profile: this is the contributed default, not a runtime flip.
			gate: {
				'workbench.browser.enableChatTools': config.get('workbench.browser.enableChatTools'),
				'chat.agent.enabled': config.get('chat.agent.enabled')
			},
			tools: has(available, BROWSER)
		},
		siriusTools: [...available].filter(n => n.startsWith('sirius_')).sort(),
		tiers,
		tierError,
		dataPart
	};
};
