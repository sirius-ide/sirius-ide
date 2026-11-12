/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's tools: Sirius's own, and those of MCP servers and other extensions
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AgentToolCall } from '../agent/core';
import { EXTERNAL_BUDGET, MAX_TOOLS_PER_REQUEST, type ExternalSource, activationResult, fit, isExtendedTier, offerExternal, offeredName, promptTsxText } from '../chat/externalTools';
import { SiriusToolExecutor, TOOL_DEFINITIONS, describeInvocation } from '../tools/toolExecutor';
import type { ChatMessage, ImagePart, SiriusModel, ToolCallResult, ToolDefinition } from '../types';
import { EDIT_NAMES, EDIT_TOOLS, type Proposal, Round, apply, propose } from './edits';
import { newId } from './sessions';
import type { Approval, Decision, EditView, Mode, ToolView } from './protocol';

const MAX_TOOL_RESULT_CHARS = 24_000;
/** What a card keeps of a tool's output, to show. What a call runs with is shown whole. */
const MAX_SHOWN_CHARS = 2_000;
/** The images every vision model takes; another type would fail the whole request. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Characters that change how text reads without being seen: shown as their code instead. */
export const UNSEEN = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
/** Extensions whose tools are their own chat's, written to run inside it: not offered. */
const OWN_CHAT_EXTENSIONS: ReadonlySet<string> = new Set(['github.copilot-chat', 'github.copilot']);

export type ToolStatus = ToolView['status'];

/** What the panel shows of each call, as it happens. */
export interface ToolEvents {
	/** A call starts: its card appears, with what it was called with, waiting for the user when `ask` is set. */
	start(call: AgentToolCall, label: string, ask: boolean, input: string): void;
	/** Asks the user; `stop` when the answer was stopped first. */
	approve(call: AgentToolCall): Promise<Approval | 'stop'>;
	finish(call: AgentToolCall, status: ToolStatus, output: string): void;
	/** A change to a file: its card appears, waiting for the user — or, under Auto-accept edits, applying. */
	propose(call: AgentToolCall, label: string, edit: EditView, proposal: Proposal): void;
	/** The user's decision on a proposed change, whenever it comes; `stop` when the answer was stopped first. */
	decide(call: AgentToolCall): Promise<Decision | 'stop'>;
	/** A round's changes are all proposed: the first is shown in the diff editor. */
	review(call: AgentToolCall): void;
}

/** Sirius's own tools, read-only and kept inside the workspace: in every mode, never asked about. */
const OWN: readonly ToolDefinition[] = TOOL_DEFINITIONS.map(definition => ({ ...definition, name: `sirius_${definition.name}` }));
const OWN_NAMES: ReadonlySet<string> = new Set(OWN.map(tool => tool.name));

/** What a card says a change does. */
function editLabel(name: string, path: string): string {
	return `${name === 'sirius_create_file' ? 'Create' : 'Edit'} ${path}`;
}

/** A call's arguments as every tool takes them: an object, whatever the model sent (none, `null`, a list). */
export function asObject(input: unknown): Record<string, unknown> {
	return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

/** What a call will run with, as its card shows it: whole, with what would not be seen made visible. */
function shownInput(input: Record<string, unknown>): string {
	return JSON.stringify(input, undefined, 2).replace(UNSEEN, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * The tools of MCP servers and other extensions that VS Code knows now, grouped by where they
 * come from. VS Code knows an MCP server's tools once it has started the server (the MCP view, or
 * its chat) and keeps them after, also once the server is stopped — calling one then starts it
 * again; a disabled server's tools are gone. The panel starts no server itself: VS Code's way to
 * start them from outside its chat would also start servers the user stopped or disabled, and ask
 * for trust on every request. A tool's source is proposed API, so it is read the stable way:
 * - an MCP server's tools carry the tag `mcp`, and names that begin `mcp_` and the server's label,
 *   lowercased with other characters as `_`; names alone cannot always tell apart two servers
 *   whose labels begin with the same word, so tools are grouped by that first word — a server's
 *   tools always stay together, and two such servers at worst share a group;
 * - another extension's are the ones its manifest declares. VS Code's own agent tools are
 *   neither; built-in extensions' and Copilot's are their own chat's. None of these is offered.
 */
export function outsideSources(self: string): ExternalSource[] {
	const declared = new Map<string, vscode.Extension<unknown>>();
	for (const extension of vscode.extensions.all) {
		const id = extension.id.toLowerCase();
		if (id === self.toLowerCase() || OWN_CHAT_EXTENSIONS.has(id) || (extension.packageJSON as { isBuiltin?: unknown } | undefined)?.isBuiltin === true) {
			continue;
		}
		const contributed = (extension.packageJSON as { contributes?: { languageModelTools?: unknown } } | undefined)?.contributes?.languageModelTools;
		for (const tool of Array.isArray(contributed) ? contributed : []) {
			if (typeof (tool as { name?: unknown })?.name === 'string') {
				declared.set((tool as { name: string }).name, extension);
			}
		}
	}
	const byKey = new Map<string, { source: Omit<ExternalSource, 'tools'>; tools: vscode.LanguageModelToolInformation[] }>();
	for (const tool of vscode.lm.tools) {
		let source: Omit<ExternalSource, 'tools'> | undefined;
		if (tool.tags.includes('mcp')) {
			const server = /^mcp_([^_]+)_/.exec(tool.name)?.[1] ?? 'mcp';
			source = { key: `mcp:${server}`, kind: 'mcp', label: server };
		} else {
			const extension = declared.get(tool.name);
			const label = (extension?.packageJSON as { displayName?: unknown } | undefined)?.displayName;
			source = extension ? { key: `extension:${extension.id}`, kind: 'extension', label: typeof label === 'string' ? label : extension.id } : undefined;
		}
		if (source) {
			const entry = byKey.get(source.key) ?? { source, tools: [] };
			entry.tools.push(tool);
			byKey.set(source.key, entry);
		}
	}
	return [...byKey.values()]
		.map(({ source, tools }) => ({ ...source, tools: tools.sort((a, b) => a.name.localeCompare(b.name)) }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/** What the model is told when opening a source would not fit the request (the panel has no tools picker). */
function refused(source: ExternalSource): string {
	return `${source.label} cannot be opened: its ${source.tools.length} tools would put this request over the model's limit of ${MAX_TOOLS_PER_REQUEST} tools. Finish with the tools that are open.`;
}

/** "read greet.ts", "echo (sirius-stub)": what a card says a call does. */
function labelOf(name: string, input: Record<string, unknown>, group?: ExternalSource): string {
	if (group) {
		return `Open the ${group.label} tools`;
	}
	if (OWN_NAMES.has(name)) {
		return describeInvocation(name.slice('sirius_'.length), input);
	}
	const mcp = /^mcp_([^_]+)_(.+)$/.exec(name);
	return mcp ? `${mcp[2].replace(/_/g, ' ')} (${mcp[1]})` : name.replace(/_/g, ' ');
}

/** A tool's result as the providers take it: its text, and the images it made. */
function resultOf(parts: readonly unknown[]): { text: string; images: ImagePart[] } {
	const text: string[] = [];
	const images: ImagePart[] = [];
	for (const part of parts) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text.push(part.value);
		} else if (part instanceof vscode.LanguageModelPromptTsxPart) {
			text.push(promptTsxText(part.value));
		} else if (part instanceof vscode.LanguageModelDataPart) {
			if (IMAGE_TYPES.has(part.mimeType)) {
				images.push({ base64: Buffer.from(part.data).toString('base64'), mimeType: part.mimeType });
			} else if (/^(text\/|application\/json)/.test(part.mimeType)) {
				text.push(new TextDecoder().decode(part.data));
			}
		}
	}
	const joined = text.join('\n');
	return { text: joined.length > MAX_TOOL_RESULT_CHARS ? `${joined.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]` : joined, images };
}

/** One round's offer, and what it takes to run a call from it. */
interface Offered {
	readonly definitions: readonly ToolDefinition[];
	readonly names: ReadonlySet<string>;
	readonly realNames: ReadonlyMap<string, string>;
	readonly groups: ReadonlyMap<string, ExternalSource>;
	readonly closedTools: ReadonlyMap<string, ExternalSource>;
}

/**
 * One answer's tools: what each round offers the model, and running what it calls. Ask and Edit
 * offer Sirius's read tools; Agent adds MCP servers' and other extensions' tools, within the
 * model's budget (chat/externalTools.ts, as in Sirius IDE's chat), and each of those asks the
 * user first unless allowed for the conversation.
 */
export class PanelTools {
	private readonly sources: ExternalSource[];
	private readonly opened: Set<string>;
	private readonly dropped: Set<string>;
	private readonly hardCap: number;
	private readonly executor = new SiriusToolExecutor();
	private current: Offered = { definitions: [], names: new Set(), realNames: new Map(), groups: new Map(), closedTools: new Map() };
	/** Outside entries in this round's offer, counting what was opened since it was made. */
	private outsideCount = 0;
	/** The round being run: its calls, and the results of those done so far. */
	private running: { readonly calls: readonly AgentToolCall[]; readonly results: ToolCallResult[] } | undefined;
	/** Sirius's tools in this mode: the read tools, and in Edit and Agent the two that change files. */
	private readonly own: readonly ToolDefinition[];
	private readonly ownNames: ReadonlySet<string>;
	/** The round's changes to files, by call: each settles once the user decided and it was applied. */
	private readonly outcomes = new Map<AgentToolCall, Promise<ToolCallResult>>();
	/** Those settled, by call: what a stop keeps, a change applied before it included. */
	private readonly settled = new Map<AgentToolCall, ToolCallResult>();
	/** The changes proposed in the tool round being run: one asked for twice is refused. */
	private seen = new Set<string>();

	constructor(
		private readonly mode: Mode,
		model: SiriusModel,
		self: string,
		/** Tools the user allowed for this conversation, by their registered names; shared, and added to. */
		private readonly allowed: Set<string>,
		/** The sources the model opened in this conversation; added to as it opens more. */
		private readonly remembered: Set<string>,
		private readonly events: ToolEvents,
		/** Whether changes to files apply as they come (Auto-accept edits), asked as each is made. */
		private readonly autoAccept: () => boolean
	) {
		this.own = mode === 'ask' ? OWN : [...OWN, ...EDIT_TOOLS];
		this.ownNames = new Set(this.own.map(tool => tool.name));
		this.sources = mode === 'agent' ? outsideSources(self) : [];
		this.hardCap = MAX_TOOLS_PER_REQUEST - this.own.length;
		const offer = fit(this.sources, isExtendedTier(model, model.contextWindow) ? EXTERNAL_BUDGET.extended : EXTERNAL_BUDGET.core, remembered, this.hardCap);
		this.opened = new Set(offer.expanded.map(source => source.key));
		this.dropped = new Set(offer.dropped.map(source => source.key));
	}

	/** Sources left out: more than this model's tools hold. */
	get droppedSources(): readonly ExternalSource[] {
		return this.sources.filter(source => this.dropped.has(source.key));
	}

	/** Fixes this round's offer: Sirius's tools, then the outside ones. */
	round(): { readonly definitions: readonly ToolDefinition[]; readonly names: ReadonlySet<string> } {
		const outside = offerExternal(this.sources, this.opened, this.dropped, this.ownNames);
		const definitions: ToolDefinition[] = [
			...this.own,
			...outside.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as ToolDefinition['inputSchema'] }))
		];
		this.current = { definitions, names: new Set(definitions.map(tool => tool.name)), realNames: outside.realNames, groups: outside.groups, closedTools: outside.closedTools };
		this.outsideCount = outside.tools.length;
		return this.current;
	}

	/** Runs a round's calls, one after another, and returns the message that carries their results. */
	async run(calls: readonly AgentToolCall[], signal: AbortSignal): Promise<ChatMessage> {
		const results: ToolCallResult[] = [];
		this.running = { calls, results };
		this.seen = new Set();
		try {
			for (const [i, call] of calls.entries()) {
				results.push(EDIT_NAMES.has(call.name) && this.current.names.has(call.name) ? await this._edit(calls, i, signal) : await this._one(call, signal));
			}
		} finally {
			this.running = undefined;
			this.outcomes.clear();
			this.settled.clear();
		}
		return { role: 'tool', content: '', timestamp: Date.now(), toolResults: results };
	}

	/**
	 * The round being run, as it would end if stopped now: the results so far, and each call not
	 * done yet answered as stopped. What the host keeps while a call waits on the user.
	 */
	stoppedRound(): ChatMessage | undefined {
		if (!this.running) {
			return undefined;
		}
		const { calls, results } = this.running;
		return {
			role: 'tool', content: '', timestamp: Date.now(),
			toolResults: calls.map((call, i) => results[i] ?? this.settled.get(call)
				?? { id: call.callId, name: call.name, content: 'Stopped by the user before it ran.', isError: true })
		};
	}

	/**
	 * A change to a file, to its result. Under Auto-accept edits it is applied as it comes, unless
	 * the file can run code when written. Otherwise the change proposes, with it, the changes that
	 * follow it in the round with no other tool between — another tool may change what they find —
	 * so all wait on their cards at once; each is applied the moment the user accepts it, in
	 * whatever order, and the model hears how each went in the order it asked.
	 */
	private async _edit(calls: readonly AgentToolCall[], at: number, signal: AbortSignal): Promise<ToolCallResult> {
		const call = calls[at];
		if (!this.outcomes.has(call)) {
			if (this.autoAccept()) {
				this.outcomes.set(call, this._auto(call, signal));
			} else {
				let end = at;
				while (end < calls.length && EDIT_NAMES.has(calls[end].name) && this.current.names.has(calls[end].name)) {
					end++;
				}
				await this._propose(calls.slice(at, end), signal);
			}
		}
		return this.outcomes.get(call)!;
	}

	/** Proposes changes together; one that cannot be made fails on its card, unasked. */
	private async _propose(calls: readonly AgentToolCall[], signal: AbortSignal): Promise<void> {
		const batch = newId();
		const round = new Round(this.seen);
		let first: AgentToolCall | undefined;
		for (const call of calls) {
			const made = await this._make(call, round, signal);
			if (made) {
				this._ask(call, made, batch);
				first ??= call;
			}
		}
		if (first) {
			this.events.review(first);
		}
	}

	/** A call's proposal; when it cannot be made, its card fails — or stops — and the call has its result. */
	private async _make(call: AgentToolCall, round: Round, signal: AbortSignal): Promise<Proposal | undefined> {
		const input = asObject(call.input);
		const made = signal.aborted ? undefined : await propose(call.name, input, round).catch(error => `Tool failed: ${error instanceof Error ? error.message : String(error)}`);
		if (typeof made === 'object') {
			return made;
		}
		this.events.start(call, editLabel(call.name, String(input.path ?? '')), false, '');
		this.outcomes.set(call, Promise.resolve(this._settle(call, made === undefined ? 'stopped' : 'failed', made ?? 'Stopped by the user before it ran.')));
		return undefined;
	}

	/** A change waits on its card for the user's Accept or Reject. */
	private _ask(call: AgentToolCall, made: Proposal, batch: string): void {
		this.events.propose(call, editLabel(call.name, made.path), { path: made.path, kind: made.kind, added: made.added, removed: made.removed, batch, ...(made.guarded ? { guarded: true } : {}) }, made);
		this.outcomes.set(call, this.events.decide(call).then(choice => this._decided(call, made, choice)));
	}

	private async _decided(call: AgentToolCall, proposal: Proposal, choice: Decision | 'stop'): Promise<ToolCallResult> {
		if (choice === 'stop') {
			return this._settle(call, 'stopped', 'Stopped by the user before it ran.');
		}
		if (choice === 'reject') {
			return this._settle(call, 'denied', `The user rejected this change to ${proposal.path}; the file is unchanged. Do not make it again; carry on without it, or ask the user.`);
		}
		try {
			const outcome = await apply(proposal);
			return this._settle(call, outcome.ok ? 'done' : 'failed', outcome.text);
		} catch (error) {
			return this._settle(call, 'failed', `Tool failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * A change under Auto-accept edits: applied at once, its diff a click away — or, for a file that
	 * can run code when written, asked about all the same.
	 */
	private async _auto(call: AgentToolCall, signal: AbortSignal): Promise<ToolCallResult> {
		const made = await this._make(call, new Round(this.seen), signal);
		if (!made) {
			return this.outcomes.get(call)!;
		}
		if (made.guarded) {
			this._ask(call, made, newId());
			this.events.review(call);
			return this.outcomes.get(call)!;
		}
		this.events.propose(call, editLabel(call.name, made.path), { path: made.path, kind: made.kind, added: made.added, removed: made.removed, batch: newId(), auto: true }, made);
		return this._decided(call, made, 'accept');
	}

	/** A change's card shows how it went, and the model hears the same; kept first, so a save made as the card changes has it. */
	private _settle(call: AgentToolCall, status: ToolStatus, text: string): ToolCallResult {
		const result: ToolCallResult = { id: call.callId, name: call.name, content: text, ...(status === 'done' ? {} : { isError: true }) };
		this.settled.set(call, result);
		this.events.finish(call, status, text);
		return result;
	}

	/** One call, to its result: whatever happens, the call gets one, or the conversation could not go on. */
	private async _one(call: AgentToolCall, signal: AbortSignal): Promise<ToolCallResult> {
		let started = false;
		const shown = (text: string) => text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS)}…` : text;
		const result = (content: string, status: ToolStatus, images: ImagePart[] = []): ToolCallResult => {
			if (!started) {
				this.events.start(call, call.name, false, '');
			}
			this.events.finish(call, status, shown(content));
			return { id: call.callId, name: call.name, content, ...(status === 'done' ? {} : { isError: true }), ...(images.length ? { images } : {}) };
		};
		try {
			return await this._run(call, signal, result, (label, ask, input) => {
				started = true;
				this.events.start(call, label, ask, shownInput(input));
			});
		} catch (error) {
			return result(`Tool failed: ${error instanceof Error ? error.message : String(error)}`, 'failed');
		}
	}

	private async _run(call: AgentToolCall, signal: AbortSignal, result: (content: string, status: ToolStatus, images?: ImagePart[]) => ToolCallResult, start: (label: string, ask: boolean, input: Record<string, unknown>) => void): Promise<ToolCallResult> {
		const input = asObject(call.input);
		const { names, realNames, groups, closedTools } = this.current;
		const group = groups.get(call.name);
		// A model can name any tool — hallucinated, or steered by a file it read. Only what this mode
		// offered runs; a closed group's own tool, called straight from the group's description,
		// opens the group first, as if the model had opened it.
		const direct = names.has(call.name) ? undefined : closedTools.get(call.name);
		if (!names.has(call.name) && !direct) {
			start(labelOf(call.name, input), false, input);
			return result(`${call.name} is not available in ${this.mode === 'ask' ? 'Ask' : this.mode === 'edit' ? 'Edit' : 'Agent'} mode.`, 'failed');
		}
		if (signal.aborted) {
			start(labelOf(call.name, input, group), false, input);
			return result('Stopped by the user before it ran.', 'stopped');
		}
		if (OWN_NAMES.has(call.name)) {
			start(labelOf(call.name, input), false, input);
			const outcome = await this.executor.execute({ id: call.callId, name: call.name.slice('sirius_'.length), arguments: input });
			const text = outcome.success ? outcome.output : `Tool failed: ${outcome.output}`;
			return result(text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]` : text, outcome.success ? 'done' : 'failed');
		}
		if (group) {
			start(labelOf(call.name, input, group), false, input);
			return this._open(group) ? result(activationResult(group), 'done') : result(refused(group), 'failed');
		}
		if (direct && !this._open(direct)) {
			start(labelOf(call.name, input), false, input);
			return result(refused(direct), 'failed');
		}
		const real = realNames.get(call.name) ?? direct?.tools.find(tool => offeredName(tool.name) === call.name || tool.name === call.name)?.name ?? call.name;
		const ask = !this.allowed.has(real);
		start(labelOf(real, input), ask, input);
		if (ask) {
			const choice = await this.events.approve(call);
			if (choice === 'stop') {
				return result('Stopped by the user before it ran.', 'stopped');
			}
			if (choice === 'deny') {
				return result(`The user declined to run ${call.name}. Do not call it again for this; carry on without it, or ask the user.`, 'denied');
			}
			if (choice === 'session') {
				this.allowed.add(real);
			}
		}
		const cancel = new vscode.CancellationTokenSource();
		const onAbort = () => cancel.cancel();
		signal.addEventListener('abort', onAbort);
		try {
			const { text, images } = resultOf((await vscode.lm.invokeTool(real, { input, toolInvocationToken: undefined }, cancel.token)).content);
			return result(text, 'done', images);
		} catch (error) {
			if (signal.aborted) {
				return result('Stopped by the user while it ran.', 'stopped');
			}
			// VS Code asks again, in its own dialog, for a tool that declares it changes things;
			// declined there, the call is cancelled.
			if (error instanceof vscode.CancellationError || (error as { name?: unknown })?.name === 'Canceled') {
				return result(`The user declined to run ${call.name} when VS Code asked. Do not call it again for this; carry on without it, or ask the user.`, 'denied');
			}
			return result(`Tool failed: ${error instanceof Error ? error.message : String(error)}`, 'failed');
		} finally {
			signal.removeEventListener('abort', onAbort);
			cancel.dispose();
		}
	}

	/** Opens a closed source for the next round, unless the request could not hold it. */
	private _open(source: ExternalSource): boolean {
		if (this.opened.has(source.key)) {
			return true;
		}
		if (this.outsideCount - 1 + source.tools.length > this.hardCap) {
			return false;
		}
		this.outsideCount += source.tools.length - 1;
		this.opened.add(source.key);
		this.remembered.add(source.key);
		return true;
	}
}
