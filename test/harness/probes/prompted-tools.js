/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Proves prompted tools end to end through the public API, against a model the
// server reports as lacking the `tools` capability (the native field is an
// HTTP 400 on it, so before this path existed such a model could not be used
// in agent mode at all).
//
// Round 1: offered one tool and asked for something that needs it, the bridge
// must hand back a real LanguageModelToolCallPart — the Ollama provider
// switched to the prompted envelope and parsed it.
// Round 2: given the tool's result, the model must answer in prose, and that
// prose must arrive in more than one text part — the `final` string streamed
// out of the envelope rather than landing after the closing brace.

exports.run = async function (vscode) {
	const all = (await vscode.lm.selectChatModels()).filter(m => m.vendor.startsWith('sirius-'));
	const tiers = await vscode.commands.executeCommand('sirius.ai.debug.toolTier');
	// The smallest no-tools model: the provider refuses to load anything over
	// sirius.ai.ollama.largeModelBytes (12 GB) because doing so has frozen this
	// machine before, and the first such model on the probe machine is 15.7 GB.
	const noTools = tiers.filter(t => t.supportsTools === false && t.sizeBytes).sort((a, b) => a.sizeBytes - b.sizeBytes);
	const target = noTools[0] && all.find(m => m.vendor === noTools[0].vendor && m.id === noTools[0].modelId);
	if (!target) {
		return { skipped: 'no model with supportsTools === false is available', noTools: noTools.map(t => t.id), models: all.map(m => m.id) };
	}

	const tool = {
		name: 'read_file',
		description: 'Read a file in the workspace.',
		inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative path' } }, required: ['path'] }
	};
	const collect = async response => {
		const out = { text: '', textParts: 0, toolCalls: [] };
		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				out.text += part.value;
				out.textParts++;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				out.toolCalls.push({ callId: part.callId, name: part.name, input: part.input });
			}
		}
		return out;
	};

	// Round 1 — must call the tool.
	const ask = vscode.LanguageModelChatMessage.User('Show me what is in src/main.ts. Use the tool.');
	let t0 = Date.now();
	const round1 = await collect(await target.sendRequest([ask], { tools: [tool] }));
	const round1Ms = Date.now() - t0;

	// Round 2 — hand the result back; must answer in prose, streamed.
	let round2 = null;
	let round2Ms = null;
	const call = round1.toolCalls[0];
	if (call) {
		const history = [
			ask,
			vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input)]),
			vscode.LanguageModelChatMessage.User([
				new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('export const main = () => 42;\n')])
			])
		];
		t0 = Date.now();
		round2 = await collect(await target.sendRequest(history, { tools: [tool] }));
		round2Ms = Date.now() - t0;
	}

	return {
		model: target.id,
		tier: tiers.find(t => t.id === target.id),
		round1: { ms: round1Ms, toolCalls: round1.toolCalls, leakedText: round1.text.slice(0, 160) },
		round2: round2 && {
			ms: round2Ms,
			toolCalls: round2.toolCalls,
			textParts: round2.textParts,
			streamed: round2.textParts > 1,
			mentions42: /42/.test(round2.text),
			text: round2.text.slice(0, 240)
		}
	};
};
