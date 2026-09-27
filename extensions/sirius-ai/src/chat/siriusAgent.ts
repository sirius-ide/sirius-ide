/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — the default chat agent
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { activeEditorContext, loadProjectRules } from './projectContext';
import type { SiriusLanguageModelProvider } from '../lm/languageModelProvider';
import type { SiriusModel } from '../types';

/**
 * The panel's ask, edit and agent modes are served by whichever participant
 * the product marks default — a role upstream fills with Copilot Chat. This
 * is Sirius's: an agentic loop over the user's selected model.
 *
 * Tool design notes, learned the hard way:
 * - vscode.lm.tools exposes ~29 tools including internal plumbing; offering
 *   them all overwhelms small local models into writing tool-call JSON as
 *   prose. The model gets a curated set instead.
 * - The workbench's own edit tool is core-agents-only (absent from
 *   vscode.lm.tools), so file edits are local tools here, applied through
 *   stream.textEdit — which feeds the editing session's diff, checkpoint and
 *   accept/reject flow.
 */

const PARTICIPANT_ID = 'sirius.default';
const MAX_TOOL_ROUNDS = 25;
const MAX_TOOL_RESULT_CHARS = 24_000;

/**
 * Native workbench tools, in two tiers.
 *
 * Upstream ships a real agent toolset — terminal, tasks, todo lists, plan
 * review, artifacts, subagents — and every one of them is registered whether or
 * not Copilot is present. Offering all of it to a small local model produces
 * tool-call JSON as prose (see the notes above), so the set scales with the
 * model: CORE for everyone, EXTENDED once the context window says the model can
 * hold the extra schemas without losing the plot.
 *
 * Deliberately absent: `task_complete` (signals the end of the workbench's own
 * loop; ours ends when a round makes no calls), `terminal_selection` (needs a
 * focused terminal mid-run), and the `vscode_get_*_confirmation` plumbing.
 *
 * Unreachable, so not listed: `setArtifacts` and `setArtifactRules` are
 * core-agents-only like the edit tool — registered with the tools service but
 * never exposed through `vscode.lm.tools`, as test/harness/probes/agent-tools.js
 * shows. Listing them here would filter to nothing and quietly promise a
 * capability the model never receives.
 */
const CORE_NATIVE = new Set([
	'run_in_terminal',
	'get_terminal_output',
	'manage_todo_list'
]);

const EXTENDED_NATIVE = new Set([
	...CORE_NATIVE,
	'send_to_terminal',
	'kill_terminal',
	'terminal_last_command',
	'run_task',
	'get_task_output',
	'create_and_run_task',
	'runTests',
	'runSubagent',
	'vscode_reviewPlan',
	'vscode_askQuestions',
	// The integrated browser (browserView/electron-browser/tools). These only
	// exist in `vscode.lm.tools` while `workbench.browser.enableChatTools` and
	// agent mode are on — with the gate closed the filter simply matches
	// nothing. `read_page` is the accessibility snapshot, the right primary
	// path for text-only local models; `screenshot_page` returns image/jpeg,
	// which the LM bridge now carries through to vision models.
	'open_browser_page',
	'read_page',
	'screenshot_page',
	'navigate_page',
	'click_element',
	'type_in_page'
]);

/**
 * Which tier a model earns.
 *
 * For a local model, bytes on disk is the honest signal: a Q4 7B is ~4.4 GB, a
 * 1.5B about 1 GB, and the extra schemas overwhelm the small one. The context
 * window cannot make that call — a 1.5B, a 7B and a 32B all report 32k — which
 * the runtime probe demonstrated before this existed. Only Ollama reports size
 * today (LM Studio and llama.cpp discovery do not), so anything without a size
 * falls back to the window rule, where 32k still separates small local quants
 * from frontier models.
 */
const EXTENDED_MIN_SIZE_BYTES = 4_000_000_000;
const EXTENDED_MIN_INPUT_TOKENS = 32_000;

function isExtendedTier(known: SiriusModel | undefined, maxInputTokens: number): boolean {
	if (known?.sizeBytes !== undefined) {
		return known.sizeBytes >= EXTENDED_MIN_SIZE_BYTES;
	}
	return maxInputTokens >= EXTENDED_MIN_INPUT_TOKENS;
}

/** Set at registration; the bridge is the only thing that knows a discovered model's size. */
let lmProvider: SiriusLanguageModelProvider | undefined;

const PREAMBLE =
	'You are Sirius, the AI engineer inside Sirius IDE. Answer directly and concisely in markdown. ' +
	'Use tools only when the task needs them — reading, searching, editing files, or running commands. ' +
	'Call tools through the tool-calling mechanism; never write tool-call JSON as text. ' +
	'For greetings or questions, just answer.';

// Named to match product.json's `chatExtensionOutputId`
// (`sirius.sirius-ai.Sirius AI.log`): the workbench's "show chat extension
// output" action resolves the channel by that name, and no channel of that
// name existed.
const output = vscode.window.createOutputChannel('Sirius AI');

function debug(line: string): void {
	output.appendLine(line);
	if (process.env.SIRIUS_AGENT_DEBUG) {
		console.log(`[sirius-agent] ${line}`);
	}
}

export function registerSiriusAgent(context: vscode.ExtensionContext, lm: SiriusLanguageModelProvider): void {
	lmProvider = lm;
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	context.subscriptions.push(participant, output);

	// The tier decision is otherwise only visible in the output channel, so
	// expose it: test/harness/probes/agent-tools.js asserts on this.
	context.subscriptions.push(vscode.commands.registerCommand('sirius.ai.debug.toolTier', async () => {
		const models = await vscode.lm.selectChatModels({ vendor: 'sirius' });
		return models.map(m => {
			const known = lm.getKnownModel(m.id);
			return {
				id: m.id,
				maxInputTokens: m.maxInputTokens,
				sizeBytes: known?.sizeBytes,
				tier: isExtendedTier(known, m.maxInputTokens) ? 'extended' : 'core'
			};
		});
	}));

	// product.json names this as `chatExtensionOutputExtensionStateCommand`: the
	// workbench's "Show Chat Extension Output" action runs it (racing a 5s
	// timeout) before revealing the channel above, so whatever is written here
	// is what a user pastes into a bug report. Until now the command did not
	// exist and the action logged a failure and showed a channel that also did
	// not exist.
	context.subscriptions.push(vscode.commands.registerCommand('sirius.ai.debug.extensionState', async () => {
		const config = vscode.workspace.getConfiguration('sirius.ai');
		const models = await vscode.lm.selectChatModels({ vendor: 'sirius' });
		const state = {
			at: new Date().toISOString(),
			extension: vscode.extensions.getExtension('sirius.sirius-ai')?.packageJSON?.version,
			settings: {
				defaultProvider: config.get('defaultProvider'),
				defaultModel: config.get('defaultModel'),
				thinking: config.get('thinking'),
				inlineCompletions: config.get('inlineCompletions'),
				nextEditSuggestions: config.get('nextEditSuggestions'),
				browserTools: vscode.workspace.getConfiguration().get('workbench.browser.enableChatTools')
			},
			models: models.map(m => {
				const known = lm.getKnownModel(m.id);
				return {
					id: m.id,
					window: m.maxInputTokens,
					sizeBytes: known?.sizeBytes,
					vision: known?.supportsVision,
					tier: isExtendedTier(known, m.maxInputTokens) ? 'extended' : 'core'
				};
			}),
			nativeTools: vscode.lm.tools.map(t => t.name).sort()
		};
		output.appendLine('── extension state ──');
		output.appendLine(JSON.stringify(state, null, 2));
		output.show(true);
	}));
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

	const localTools = createLocalTools(stream);
	const known = lmProvider?.getKnownModel(model.id);
	const extended = isExtendedTier(known, model.maxInputTokens);
	const allowlist = extended ? EXTENDED_NATIVE : CORE_NATIVE;
	const tools: vscode.LanguageModelChatTool[] = [
		...vscode.lm.tools
			.filter(tool => tool.name.startsWith('sirius_') || allowlist.has(tool.name))
			.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
		...localTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
	];
	const toolNames = new Set(tools.map(tool => tool.name));
	debug(`[request] model=${model.id} window=${model.maxInputTokens} size=${known?.sizeBytes ?? 'unknown'} tier=${extended ? 'extended' : 'core'} tools=${tools.length}`);

	const messages = buildMessages(chatContext, request);

	for (let round = 0; round < MAX_TOOL_ROUNDS && !token.isCancellationRequested; round++) {
		const response = await model.sendRequest(messages, { tools }, token);

		const emitted = new TextGate(stream, toolNames);
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];

		for await (const part of response.stream) {
			if (token.isCancellationRequested) {
				return {};
			}
			if (part instanceof vscode.LanguageModelTextPart) {
				emitted.push(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			}
		}
		// A small model sometimes writes its tool call as prose instead of
		// using the mechanism; the gate holds such text back so it can run as
		// a real call instead of leaking JSON into the conversation.
		const rescued = emitted.finish(round);
		toolCalls.push(...rescued);

		debug(`[round ${round}] text=${emitted.total} calls=${toolCalls.map(c => c.name).join(',') || 'none'}`);

		if (toolCalls.length === 0) {
			return {};
		}

		messages.push(vscode.LanguageModelChatMessage.Assistant([
			...(emitted.total > 0 && rescued.length === 0 ? [new vscode.LanguageModelTextPart(emitted.text)] : []),
			...toolCalls
		]));

		const results: vscode.LanguageModelToolResultPart[] = [];
		for (const call of toolCalls) {
			stream.progress(`Running ${call.name.replace(/^sirius_/, '').replace(/_/g, ' ')}…`);
			const local = localTools.find(tool => tool.name === call.name);
			try {
				if (local) {
					const text = await local.run(call.input as Record<string, unknown>);
					results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(text)]));
				} else {
					const result = await vscode.lm.invokeTool(call.name, {
						input: call.input,
						toolInvocationToken: request.toolInvocationToken
					}, token);
					results.push(new vscode.LanguageModelToolResultPart(call.callId, capContent(result.content)));
				}
			} catch (error) {
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

/**
 * Buffers a round's text so a small model's tool call written as prose — bare
 * or wrapped in a markdown fence — can be converted into a real invocation
 * instead of leaking JSON into the conversation. Long prose streams normally
 * once it is clearly not a tool call.
 */
class TextGate {
	text = '';
	total = 0;
	private streamedFrom = 0;
	private decidedProse = false;

	constructor(
		private readonly stream: vscode.ChatResponseStream,
		private readonly toolNames: ReadonlySet<string>
	) { }

	push(value: string): void {
		this.text += value;
		this.total += value.length;

		// Past this size it is an answer, not a call — stream it live.
		if (!this.decidedProse && this.total > 4096 && !this.extractCall()) {
			this.decidedProse = true;
		}
		if (this.decidedProse) {
			this.stream.markdown(this.text.slice(this.streamedFrom));
			this.streamedFrom = this.text.length;
		}
	}

	finish(round: number): vscode.LanguageModelToolCallPart[] {
		// A small model may write several calls in one breath; convert every
		// one, and only the leftover prose reaches the conversation.
		const calls: vscode.LanguageModelToolCallPart[] = [];
		let remaining = this.text;
		for (let i = 0; i < 6; i++) {
			const found = this.extractCallIn(remaining);
			if (!found) {
				break;
			}
			debug(`[rescue] textual tool call converted: ${found.name}`);
			calls.push(new vscode.LanguageModelToolCallPart(`rescued-${round}-${i}`, found.name, found.args));
			remaining = remaining.slice(0, found.start) + remaining.slice(found.end);
		}
		if (calls.length > 0) {
			const prose = remaining.replace(/```[a-zA-Z]*\s*```/g, '').trim();
			if (prose) {
				this.stream.markdown(prose + '\n\n');
			}
			return calls;
		}
		if (this.streamedFrom < this.text.length) {
			this.stream.markdown(this.text.slice(this.streamedFrom));
			this.streamedFrom = this.text.length;
		}
		return calls;
	}

	private extractCall(): { name: string; args: object; start: number; end: number } | undefined {
		return this.extractCallIn(this.text);
	}

	/** A fenced or bare {"name": ..., "arguments": ...} for a known tool. */
	private extractCallIn(text: string): { name: string; args: object; start: number; end: number } | undefined {
		const fenced = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/.exec(text);
		const candidates: Array<{ body: string; start: number; end: number }> = [];
		if (fenced) {
			candidates.push({ body: fenced[1], start: fenced.index, end: fenced.index + fenced[0].length });
		}
		const brace = text.indexOf('{');
		if (brace !== -1) {
			const close = text.lastIndexOf('}');
			if (close > brace) {
				candidates.push({ body: text.slice(brace, close + 1), start: brace, end: close + 1 });
			}
		}
		for (const candidate of candidates) {
			try {
				const parsed = JSON.parse(candidate.body.trim()) as { name?: string; arguments?: unknown };
				if (parsed && typeof parsed.name === 'string' && this.toolNames.has(parsed.name)) {
					return {
						name: parsed.name,
						args: (parsed.arguments as object | undefined) ?? {},
						start: candidate.start,
						end: candidate.end
					};
				}
			} catch {
				// keep looking
			}
		}
		return undefined;
	}
}

interface LocalTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: object;
	run(input: Record<string, unknown>): Promise<string>;
}

function workspaceUri(relativePath: string): vscode.Uri {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		throw new Error('No workspace folder is open.');
	}
	return vscode.Uri.joinPath(root, relativePath);
}

/**
 * Mutating tools live here rather than in the executor because their effect
 * must flow through the response stream: stream.textEdit is what lands changes
 * in the editing session, with its diff and accept/reject controls.
 */
function createLocalTools(stream: vscode.ChatResponseStream): LocalTool[] {
	return [
		{
			name: 'edit_file',
			description: 'Replace an exact span of text in an existing file. The search text must match exactly and appear exactly once.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path relative to the workspace root' },
					search: { type: 'string', description: 'Exact text to find' },
					replace: { type: 'string', description: 'Text to put in its place' }
				},
				required: ['path', 'search', 'replace']
			},
			async run(input) {
				const uri = workspaceUri(String(input.path ?? ''));
				const document = await vscode.workspace.openTextDocument(uri);
				const content = document.getText();
				const search = String(input.search ?? '');
				const first = content.indexOf(search);
				if (first === -1) {
					return 'Search text not found. Read the file again — it may have changed.';
				}
				if (content.indexOf(search, first + 1) !== -1) {
					return 'Search text appears more than once; include more surrounding context to make it unique.';
				}
				const range = new vscode.Range(document.positionAt(first), document.positionAt(first + search.length));
				stream.textEdit(uri, [vscode.TextEdit.replace(range, String(input.replace ?? ''))]);
				return `Edited ${input.path}.`;
			}
		},
		{
			name: 'create_file',
			description: 'Create a new file with the given contents. Fails if the file already exists — use edit_file for that.',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path relative to the workspace root' },
					content: { type: 'string', description: 'Full contents of the new file' }
				},
				required: ['path', 'content']
			},
			async run(input) {
				const uri = workspaceUri(String(input.path ?? ''));
				// `createFile` with ignoreIfExists reported success on a path that
				// already existed, and the insert below then PREPENDED the new content
				// to that file. Refuse instead: a model asking to "create" something
				// that exists has lost track of the tree, and edit_file is the tool
				// for a file that is already there.
				try {
					await vscode.workspace.fs.stat(uri);
					return `${input.path} already exists. Read it, then use edit_file to change it — or choose another path.`;
				} catch {
					// FileNotFound is the expected outcome; fall through and create.
				}
				const edit = new vscode.WorkspaceEdit();
				edit.createFile(uri, { ignoreIfExists: true });
				await vscode.workspace.applyEdit(edit);
				stream.textEdit(uri, [
					vscode.TextEdit.insert(new vscode.Position(0, 0), String(input.content ?? ''))
				]);
				return `Created ${input.path}.`;
			}
		}
	];
}

function buildMessages(chatContext: vscode.ChatContext, request: vscode.ChatRequest): vscode.LanguageModelChatMessage[] {
	// Standing project instructions ride with every request, ahead of history.
	const rules = loadProjectRules();
	const preamble = rules.text
		? `${PREAMBLE}\n\nProject instructions (from ${rules.sources.join(', ')}) — follow these:\n${rules.text}`
		: PREAMBLE;

	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(preamble)
	];

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

	const attachments: string[] = [];
	for (const reference of request.references) {
		const value = reference.value;
		if (value instanceof vscode.Uri) {
			attachments.push(value.fsPath);
		} else if (value instanceof vscode.Location) {
			attachments.push(`${value.uri.fsPath}:${value.range.start.line + 1}`);
		}
	}

	let prompt = attachments.length
		? `${request.prompt}\n\n(Attached: ${attachments.join(', ')})`
		: request.prompt;

	// What the user is looking at is context they meant implicitly.
	const active = activeEditorContext();
	if (active) {
		prompt = `${active}\n\n${prompt}`;
	}
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
