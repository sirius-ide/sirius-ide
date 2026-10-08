/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — the default chat agent
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { activeEditorContext, loadProjectRules } from './projectContext';
import { selectDefaultModel } from '../lm/defaultModel';
import { resolveWorkspacePath } from '../tools/workspacePath';
import { TOOL_DEFINITIONS } from '../tools/toolExecutor';
import * as path from 'path';
import { randomBytes } from 'crypto';
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

type Mode = 'ask' | 'edit' | 'agent';

/**
 * One participant per built-in mode. The workbench chooses the default
 * participant by the mode's kind, and that choice is the only place the mode is
 * visible: the built-in Ask, Edit and Agent modes carry no instructions on the
 * request. With one participant declared for all three, Ask ran terminal
 * commands and edited files exactly like Agent. Splitting loses no history on a
 * mode switch — the extension host hands every turn of the session to whichever
 * participant answers.
 */
const PARTICIPANTS: ReadonlyArray<{ readonly id: string; readonly mode: Mode }> = [
	{ id: 'sirius.default', mode: 'ask' },
	{ id: 'sirius.edit', mode: 'edit' },
	{ id: 'sirius.agent', mode: 'agent' }
];

/** Sirius's own registered tools — all read-only — by the names toolRegistration gives them. */
const SIRIUS_TOOLS: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map(definition => `sirius_${definition.name}`));

/**
 * Editing runs through the response stream (createLocalTools), so it cannot be an ordinary
 * tool — but agent files and the tools picker grant tools by registered name. These two
 * registrations exist for that: `editFile` in an .agent.md's tools (the default chat
 * extension's tools are internal, so no extension prefix), or unticking Edit File in the
 * picker, decides whether edit_file is offered.
 */
const EDIT_TOOLS: Readonly<Record<string, string>> = { edit_file: 'sirius_edit_file', create_file: 'sirius_create_file' };

/** Instructions longer than this are cut, like project rules. */
const MAX_AGENT_INSTRUCTIONS_CHARS = 8_000;

/**
 * A custom agent — an .agent.md: Sirius's own Ask and Edit, or one the user wrote — arrives at
 * the Agent participant (every custom agent is agent-kind) carrying its instructions; the
 * built-in modes carry none.
 */
function customAgent(request: vscode.ChatRequest): { readonly name: string; readonly instructions: string } | undefined {
	const agent = request.modeInstructions2;
	return agent && !agent.isBuiltin ? { name: agent.name, instructions: agent.content } : undefined;
}

/** What each mode may do, stated to the model so it does not reach for a tool it lacks. */
const MODE_RULES: Record<Mode, string> = {
	ask: 'You are in Ask mode: explain and answer. You can read and search the workspace, but you cannot change files or run commands here — when a change is needed, describe it; the user can switch to Edit or Agent mode to make it.',
	edit: 'You are in Edit mode: read the workspace and change files with edit_file and create_file. You cannot run commands here.',
	agent: ''
};
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
	// A model on prompted tools carries every schema in its prompt and writes
	// the call envelope itself; the small set is the one it can follow.
	if (known?.supportsTools === false) {
		return false;
	}
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
	for (const { id, mode } of PARTICIPANTS) {
		const participant = vscode.chat.createChatParticipant(id, createHandler(mode));
		participant.iconPath = new vscode.ThemeIcon('sparkle');
		context.subscriptions.push(participant);
	}
	// Named in package.json so agents and the picker can grant them; the participant runs the
	// real edit itself, so a call that reaches here came from somewhere else.
	for (const name of Object.values(EDIT_TOOLS)) {
		context.subscriptions.push(vscode.lm.registerTool(name, {
			invoke: () => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'Sirius makes edits from its own chat, through the editor\'s Keep and Undo. Ask Sirius in the chat to make this change.'
			)])
		}));
	}
	context.subscriptions.push(output);

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
				supportsTools: known?.supportsTools,
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

const createHandler = (mode: Mode): vscode.ChatRequestHandler => async (request, chatContext, stream, token) => {
	let model: vscode.LanguageModelChat | undefined = request.model;
	if (!model) {
		model = await selectDefaultModel();
	}
	if (!model) {
		stream.markdown(
			'No model is available yet. Add a provider key with **Sirius: Set API Key** ' +
			'(Ctrl+Shift+P), or start [Ollama](https://ollama.com) and pull a model — Sirius finds it automatically.'
		);
		return {};
	}

	// Built-in modes: Ask reads; Edit reads and changes files; only Agent runs
	// commands, tasks, subagents and the browser — less anything the user unticked
	// in the tools picker. A custom agent gets exactly the tools its file allows,
	// and never more than Agent would offer: the workbench passes that list in
	// `request.tools` but does not enforce it, so this is the only place an
	// agent's `tools:` means anything. Sirius's own registered tools are all
	// read-only; they are matched by the names this extension registered, so
	// another extension's `sirius_*` tool is not swept in.
	const agent = customAgent(request);
	const known = lmProvider?.getKnownModel(model.id);
	const extended = isExtendedTier(known, model.maxInputTokens);
	const allowlist = agent || mode === 'agent' ? (extended ? EXTENDED_NATIVE : CORE_NATIVE) : new Set<string>();
	const choice = new Map(Array.from(request.tools ?? [], ([tool, enabled]) => [tool.name, enabled] as const));
	const permitted = (name: string): boolean => agent ? choice.get(name) === true : choice.get(name) !== false;
	const localTools = mode === 'ask' && !agent ? [] : createLocalTools(stream).filter(tool => permitted(EDIT_TOOLS[tool.name]));
	const tools: vscode.LanguageModelChatTool[] = [
		...vscode.lm.tools
			.filter(tool => (SIRIUS_TOOLS.has(tool.name) || allowlist.has(tool.name)) && permitted(tool.name))
			.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
		...localTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
	];
	const toolNames = new Set(tools.map(tool => tool.name));
	const scope = agent ? `the ${agent.name} agent` : `${mode} mode`;
	if (agent) {
		debug(`[request] ${scope} enables ${[...choice].filter(([, enabled]) => enabled).map(([name]) => name).join(',') || 'nothing'} (of ${choice.size} known)`);
	}
	debug(`[request] mode=${mode}${agent ? ` agent=${agent.name} instructions=${agent.instructions.length}` : ''} model=${model.id} window=${model.maxInputTokens} size=${known?.sizeBytes ?? 'unknown'} tier=${extended ? 'extended' : 'core'} tools=${tools.length} (${[...toolNames].join(',')})`);

	const messages = await buildMessages(chatContext, request, mode, model.maxInputTokens);
	const prompt = messages[messages.length - 1].content;
	const images = prompt.filter(part => part instanceof vscode.LanguageModelDataPart).length;
	if (images > 0) {
		debug(`[request] images=${images} vision=${known?.supportsVision ?? 'unknown'}`);
	}

	for (let round = 0; round < MAX_TOOL_ROUNDS && !token.isCancellationRequested; round++) {
		const response = await model.sendRequest(messages, { tools }, token);

		const emitted = new TextGate(stream, toolNames);
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		let thinking = 0;

		for await (const part of response.stream) {
			if (token.isCancellationRequested) {
				return {};
			}
			if (part instanceof vscode.LanguageModelTextPart) {
				emitted.push(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			} else if (part instanceof vscode.LanguageModelThinkingPart) {
				// The providers request thinking and the bridge reports it; without
				// this the transcript dropped it, so the reasoning was paid for and
				// never shown. The workbench renders it as a collapsible section.
				const text = Array.isArray(part.value) ? part.value.join('') : part.value;
				if (text) {
					thinking += text.length;
					stream.thinkingProgress({ text, id: part.id ?? `thinking-${round}`, metadata: part.metadata });
				}
			}
		}
		// A small model sometimes writes its tool call as prose instead of
		// using the mechanism; the gate holds such text back so it can run as
		// a real call instead of leaking JSON into the conversation.
		const rescued = emitted.finish(round);
		toolCalls.push(...rescued);

		debug(`[round ${round}] text=${emitted.total} thinking=${thinking} calls=${toolCalls.map(c => c.name).join(',') || 'none'}`);

		if (toolCalls.length === 0) {
			return {};
		}

		messages.push(vscode.LanguageModelChatMessage.Assistant([
			...(emitted.total > 0 && rescued.length === 0 ? [new vscode.LanguageModelTextPart(emitted.text)] : []),
			...toolCalls
		]));

		const results: vscode.LanguageModelToolResultPart[] = [];
		for (const call of toolCalls) {
			// A model can name any tool — hallucinated, or steered by a file it
			// read. Only what this mode offered runs; otherwise Ask's read-only set
			// was a suggestion, and `run_in_terminal` ran if a model asked for it.
			if (!toolNames.has(call.name)) {
				debug(`[refused] ${call.name} is not offered in ${scope}`);
				results.push(new vscode.LanguageModelToolResultPart(call.callId, [
					new vscode.LanguageModelTextPart(`${call.name} is not available in ${scope}.`)
				]));
				continue;
			}
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

/** File-changing tools stay inside the workspace, like the read tools (see workspacePath.ts). */
function workspaceUri(target: string): Promise<vscode.Uri> {
	return resolveWorkspacePath(target);
}

/**
 * Mutating tools live here rather than in the executor because their effect
 * must flow through the response stream: stream.textEdit is what lands changes
 * in the editing session, with its diff and accept/reject controls.
 */
function createLocalTools(stream: vscode.ChatResponseStream): LocalTool[] {
	// The editing session writes a new file only when the response is processed,
	// so a second create of the same path in one request would pass the stat
	// check below and both contents would land in one file.
	const created = new Set<string>();
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
				const uri = await workspaceUri(String(input.path ?? ''));
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
				const uri = await workspaceUri(String(input.path ?? ''));
				// `createFile` with ignoreIfExists reported success on a path that
				// already existed, and the insert below then PREPENDED the new content
				// to that file. Refuse instead: a model asking to "create" something
				// that exists has lost track of the tree, and edit_file is the tool
				// for a file that is already there.
				if (created.has(uri.toString())) {
					return `${input.path} was already created in this response. Use edit_file to change it.`;
				}
				try {
					await vscode.workspace.fs.stat(uri);
					return `${input.path} already exists. Read it, then use edit_file to change it — or choose another path.`;
				} catch {
					// FileNotFound is the expected outcome; fall through and create.
				}
				created.add(uri.toString());
				// The editing session creates the file itself: a streamed edit to a
				// path that does not exist yet becomes a "created" entry, recorded as
				// a file creation in the session's timeline, so Keep / Undo and the
				// checkpoints cover the new file the way they cover an edit. Creating
				// it here first, with `workspace.applyEdit`, put the creation outside
				// that flow — the session saw an existing empty file it had only
				// modified.
				stream.textEdit(uri, [
					vscode.TextEdit.insert(new vscode.Position(0, 0), String(input.content ?? ''))
				]);
				return `Created ${input.path}.`;
			}
		}
	];
}

/** Images a model can take inline; anything larger is attached by path instead. */
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A pasted image arrives as binary data, not a file: `ChatReferenceBinaryData`, matched on shape. */
function isBinaryReference(value: unknown): value is { readonly mimeType: string; data(): Thenable<Uint8Array> } {
	return typeof value === 'object' && value !== null
		&& typeof (value as { mimeType?: unknown }).mimeType === 'string'
		&& typeof (value as { data?: unknown }).data === 'function';
}

/** Text attachments ride in the prompt up to this size; larger ones are listed by path. */
const MAX_ATTACHMENT_BYTES = 100 * 1024;

/**
 * The text of an attached file, or undefined when it is too large or binary.
 *
 * Attaching a file is the user's (or, for instruction files such as a
 * `CLAUDE.md`, the workbench's) decision to share it, so its text goes to the
 * model with the prompt — as upstream's own participant does. Sending only the
 * path left the model to call read_file on it, which fails by design for an
 * attachment outside the workspace.
 */
async function attachmentText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_ATTACHMENT_BYTES || stat.type === vscode.FileType.Directory) {
			return undefined;
		}
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		return text.includes('\u0000') ? undefined : text;
	} catch {
		return undefined;
	}
}

/** The attached span of a document, as the editor holds it (unsaved edits included). */
async function locationText(location: vscode.Location): Promise<string | undefined> {
	try {
		const document = await vscode.workspace.openTextDocument(location.uri);
		const text = document.getText(location.range);
		return text.length > MAX_ATTACHMENT_BYTES ? undefined : text;
	} catch {
		return undefined;
	}
}

/** One word per reference kind, for the output channel — what a bug report needs to see. */
function describeReference(value: unknown): string {
	if (isBinaryReference(value)) {
		return `binary:${value.mimeType}`;
	}
	if (value instanceof vscode.Uri) {
		return `uri:${value.path.split('.').pop()}`;
	}
	if (value instanceof vscode.Location) {
		return 'location';
	}
	return typeof value;
}

/** An attached image file, read so the model sees the picture rather than its path. */
async function imageFromFile(uri: vscode.Uri): Promise<vscode.LanguageModelDataPart | undefined> {
	const mime = IMAGE_MIME[uri.path.split('.').pop()?.toLowerCase() ?? ''];
	if (!mime) {
		return undefined;
	}
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_IMAGE_BYTES) {
			return undefined;
		}
		return vscode.LanguageModelDataPart.image(await vscode.workspace.fs.readFile(uri), mime);
	} catch {
		return undefined;
	}
}

/** Instruction and prompt files the workbench attaches carry ids with these prefixes. */
const INSTRUCTION_REFERENCE = /^vscode\.(instructions\.file|prompt\.file)/;

/** A rough characters-per-token figure, for sizing what fits rather than counting it. */
const CHARS_PER_TOKEN = 4;

async function buildMessages(chatContext: vscode.ChatContext, request: vscode.ChatRequest, mode: Mode, maxInputTokens: number): Promise<vscode.LanguageModelChatMessage[]> {
	const rules = loadProjectRules();
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const ruleFiles = new Set(root ? rules.sources.map(source => path.join(root, source)) : []);

	// Everything inlined below shares one budget, about half the model's window,
	// so attachments and instruction files cannot crowd out the conversation; what
	// does not fit is listed by path.
	let budget = Math.max(16_000, Math.floor(maxInputTokens * CHARS_PER_TOKEN * 0.5));
	const fits = (text: string): boolean => {
		if (text.length > budget) {
			return false;
		}
		budget -= text.length;
		return true;
	};

	if (request.references.length) {
		debug(`[request] references=${request.references.map(r => describeReference(r.value)).join(',')}`);
	}

	// Instruction and prompt files the workbench attaches (AGENTS.md, CLAUDE.md,
	// *.instructions.md, a /prompt file) are standing instructions, not material
	// for this one message: they join the preamble, once — a file Sirius already
	// loads as a project rule is not sent twice.
	const instructions: string[] = [];
	const references: vscode.ChatPromptReference[] = [];
	for (const reference of request.references) {
		const value = reference.value;
		if (INSTRUCTION_REFERENCE.test(reference.id) && value instanceof vscode.Uri) {
			if (ruleFiles.has(value.fsPath)) {
				continue;
			}
			const text = await attachmentText(value);
			if (text?.trim() && fits(text)) {
				instructions.push(`Instructions (from ${value.fsPath}) — follow these:\n${text.trim()}`);
			}
			continue;
		}
		references.push(reference);
	}

	const agent = customAgent(request);
	const base = agent
		? `${PREAMBLE} You are running as the "${agent.name}" agent: follow its instructions, and use only the tools it allows.\n${agent.instructions.trim().slice(0, MAX_AGENT_INSTRUCTIONS_CHARS)}`
		: MODE_RULES[mode] ? `${PREAMBLE} ${MODE_RULES[mode]}` : PREAMBLE;
	const preamble = [
		base,
		rules.text ? `Project instructions (from ${rules.sources.join(', ')}) — follow these:\n${rules.text}` : '',
		...instructions
	].filter(Boolean).join('\n\n');

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

	// Images ride with the prompt as image parts; the language-model bridge turns
	// them into each provider's image input, and its vision guard replaces them
	// with a note for a model that cannot see. Forwarding only paths, as before,
	// meant a pasted image never reached any model.
	const attachments: string[] = [];
	const inlined: Array<{ label: string; text: string }> = [];
	const images: vscode.LanguageModelDataPart[] = [];
	for (const reference of references) {
		const value = reference.value;
		if (isBinaryReference(value)) {
			// The four formats every vision provider accepts; a BMP or SVG would
			// fail the whole request.
			if (Object.values(IMAGE_MIME).includes(value.mimeType)) {
				images.push(vscode.LanguageModelDataPart.image(await value.data(), value.mimeType));
			}
		} else if (value instanceof vscode.Uri) {
			const image = await imageFromFile(value);
			const text = image ? undefined : await attachmentText(value);
			if (image) {
				images.push(image);
			} else if (text !== undefined && fits(text)) {
				inlined.push({ label: value.fsPath, text });
			} else {
				attachments.push(value.fsPath);
			}
		} else if (value instanceof vscode.Location) {
			const label = `${value.uri.fsPath}:${value.range.start.line + 1}-${value.range.end.line + 1}`;
			const text = await locationText(value);
			if (text !== undefined && fits(text)) {
				inlined.push({ label, text });
			} else {
				attachments.push(label);
			}
		}
	}

	// Context first, the user's own words last. Each attachment sits between
	// tags named with a per-request nonce, so a file's content cannot close its
	// block early and continue as if it were the user.
	const fence = `attachment-${randomBytes(6).toString('hex')}`;
	const context: string[] = [];
	const active = activeEditorContext();
	if (active) {
		context.push(active);
	}
	for (const { label, text } of inlined) {
		context.push(`<${fence} path="${label}">\n${text}\n</${fence}>`);
	}
	if (attachments.length) {
		context.push(`(Attached, not shown: ${attachments.join(', ')})`);
	}
	const prompt = [...context, request.prompt].join('\n\n');

	messages.push(images.length
		? vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(prompt), ...images])
		: vscode.LanguageModelChatMessage.User(prompt));

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
