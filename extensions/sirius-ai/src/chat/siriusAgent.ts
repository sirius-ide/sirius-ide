/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — the default chat agent
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * The panel's ask, edit and agent modes are served by whichever participant
 * the product marks default — a role upstream fills with Copilot Chat. This
 * is Sirius's: an agentic loop over the user's selected model, calling the
 * editor's registered tools, whose edit and terminal tools already carry the
 * review and approval flows.
 */

const PARTICIPANT_ID = 'sirius.default';

/** Rounds of model → tools → model before the loop declares itself stuck. */
const MAX_TOOL_ROUNDS = 25;

/** Tool results larger than this are truncated before rejoining the context. */
const MAX_TOOL_RESULT_CHARS = 24_000;

export function registerSiriusAgent(context: vscode.ExtensionContext): void {
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	context.subscriptions.push(participant);
}

const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
	let model = request.model;
	if (!model) {
		[model] = await vscode.lm.selectChatModels({ vendor: 'sirius' });
	}
	if (!model) {
		stream.markdown(
			'No model is available yet. Add a provider key with **Sirius: Set API Key** ' +
			'(Ctrl+Shift+P), or start [Ollama](https://ollama.com) and pull a model — Sirius finds it automatically.'
		);
		return {};
	}

	const messages = buildMessages(chatContext, request);
	const tools: vscode.LanguageModelChatTool[] = vscode.lm.tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema
	}));

	for (let round = 0; round < MAX_TOOL_ROUNDS && !token.isCancellationRequested; round++) {
		const response = await model.sendRequest(messages, { tools }, token);

		let responseText = '';
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];

		for await (const part of response.stream) {
			if (token.isCancellationRequested) {
				return {};
			}
			if (part instanceof vscode.LanguageModelTextPart) {
				responseText += part.value;
				stream.markdown(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			}
		}

		if (toolCalls.length === 0) {
			return {};
		}

		// The turn so far, tool calls included, becomes context for the next round.
		messages.push(vscode.LanguageModelChatMessage.Assistant([
			...(responseText ? [new vscode.LanguageModelTextPart(responseText)] : []),
			...toolCalls
		]));

		const results: vscode.LanguageModelToolResultPart[] = [];
		for (const call of toolCalls) {
			stream.progress(`Running ${call.name.replace(/^sirius_/, '').replace(/_/g, ' ')}…`);
			try {
				const result = await vscode.lm.invokeTool(call.name, {
					input: call.input,
					toolInvocationToken: request.toolInvocationToken
				}, token);
				results.push(new vscode.LanguageModelToolResultPart(call.callId, capContent(result.content)));
			} catch (error) {
				// The model needs to read the failure, not be left waiting on a
				// call it can see it made.
				results.push(new vscode.LanguageModelToolResultPart(call.callId, [
					new vscode.LanguageModelTextPart(`Tool failed: ${error instanceof Error ? error.message : String(error)}`)
				]));
			}
		}
		messages.push(vscode.LanguageModelChatMessage.User(results));
	}

	if (!token.isCancellationRequested) {
		stream.markdown('\n\nStopping here — this task took more tool rounds than expected. Say "continue" to keep going.');
	}
	return {};
};

function buildMessages(chatContext: vscode.ChatContext, request: vscode.ChatRequest): vscode.LanguageModelChatMessage[] {
	const messages: vscode.LanguageModelChatMessage[] = [];

	for (const turn of chatContext.history) {
		if (turn instanceof vscode.ChatRequestTurn) {
			messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const text = turn.response
				.filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
				.map(part => part.value.value)
				.join('');
			if (text) {
				messages.push(vscode.LanguageModelChatMessage.Assistant(text));
			}
		}
	}

	// References the user attached (files, selections) ride along as context.
	const attachments: string[] = [];
	for (const reference of request.references) {
		const value = reference.value;
		if (value instanceof vscode.Uri) {
			attachments.push(value.fsPath);
		} else if (value instanceof vscode.Location) {
			attachments.push(`${value.uri.fsPath}:${value.range.start.line + 1}`);
		}
	}

	const prompt = attachments.length
		? `${request.prompt}\n\n(Attached: ${attachments.join(', ')})`
		: request.prompt;
	messages.push(vscode.LanguageModelChatMessage.User(prompt));

	return messages;
}

function capContent(content: unknown[]): unknown[] {
	return content.map(part => {
		if (part instanceof vscode.LanguageModelTextPart && part.value.length > MAX_TOOL_RESULT_CHARS) {
			return new vscode.LanguageModelTextPart(part.value.slice(0, MAX_TOOL_RESULT_CHARS) + '\n[truncated]');
		}
		return part;
	});
}
