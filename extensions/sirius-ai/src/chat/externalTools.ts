/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — MCP servers' and other extensions' tools in the chat
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Tools that are neither Sirius's nor the workbench's: an MCP server's, or another
 * extension's. The editor already does most of the work — they arrive in `vscode.lm.tools`
 * with their source, the tools picker and an agent file's `tools:` decide which are enabled,
 * and invoking one goes back through the editor, approval dialog included. What this module
 * adds is the budget. A model is handed a server's tools directly only while the set stays
 * small enough for it; every other server is one *group* tool the model calls to open it,
 * and what it opened stays open for the rest of the conversation (the participant returns
 * the opened keys as result metadata, and reads them back from the history).
 */

export interface ExternalSource {
	/** Stable across requests: `mcp:<label>` or `extension:<id>`. */
	readonly key: string;
	readonly kind: 'mcp' | 'extension';
	/** The server's label in mcp.json and the picker, or the extension's display name. */
	readonly label: string;
	/** An MCP server's own instructions for using its tools, if it sent any. */
	readonly instructions?: string;
	readonly tools: readonly vscode.LanguageModelToolInformation[];
}

/** External tool schemas a model is handed without asking, by tier (chat/siriusAgent.ts). */
export const EXTERNAL_BUDGET = { core: 8, extended: 64 } as const;

/**
 * The most external tools open at once, however the model got there: OpenAI takes 128
 * tools per request, and the workbench's and Sirius's own are about thirty of those.
 */
export const EXTERNAL_HARD_CAP = 96;

const GROUP_PREFIX = 'activate_';
const MAX_GROUP_DESCRIPTION_CHARS = 1_200;
const MAX_SERVER_INSTRUCTIONS_CHARS = 2_000;
/** What every provider accepts as a tool name — OpenAI's rule; the others are looser. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The source of a tool, when it is an MCP server or another extension. */
export function sourceOf(tool: vscode.LanguageModelToolInformation): Omit<ExternalSource, 'tools'> | undefined {
	const source = tool.source;
	if (source instanceof vscode.LanguageModelToolMCPSource) {
		return { key: `mcp:${source.label}`, kind: 'mcp', label: source.label, instructions: source.instructions };
	}
	if (source instanceof vscode.LanguageModelToolExtensionSource) {
		return { key: `extension:${source.id}`, kind: 'extension', label: source.label };
	}
	return undefined;
}

/** The external tools among `tools`, grouped by source, in a stable order. */
export function externalSources(tools: Iterable<vscode.LanguageModelToolInformation>): ExternalSource[] {
	const byKey = new Map<string, { meta: Omit<ExternalSource, 'tools'>; tools: vscode.LanguageModelToolInformation[] }>();
	for (const tool of tools) {
		const meta = sourceOf(tool);
		if (!meta) {
			continue;
		}
		const entry = byKey.get(meta.key) ?? { meta, tools: [] };
		entry.tools.push(tool);
		byKey.set(meta.key, entry);
	}
	return [...byKey.values()]
		.map(({ meta, tools }) => ({ ...meta, tools: tools.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export interface Offer {
	/** Their tools go to the model as they are. */
	readonly expanded: ExternalSource[];
	/** Each is one group tool the model can call to open it. */
	readonly collapsed: ExternalSource[];
	/** Not offered at all: more sources than the budget has slots for. */
	readonly dropped: ExternalSource[];
}

/**
 * Which sources to open for a request. Three rules, in order:
 *
 * 1. What the model opened earlier in this conversation stays open, up to the hard cap.
 * 2. Small sources come open while the budget holds (a closed source costs one slot, an open
 *    one costs its tools); the rest stay closed groups.
 * 3. With more sources than the budget has slots, the largest closed ones are left out —
 *    the caller says so in the response.
 */
export function fit(sources: readonly ExternalSource[], budget: number, remembered: ReadonlySet<string>): Offer {
	const bySize = sources.slice().sort((a, b) => a.tools.length - b.tools.length || a.label.localeCompare(b.label));
	const expanded = new Set<string>();
	let cost = sources.length;
	let open = 0;
	const expand = (source: ExternalSource): void => {
		expanded.add(source.key);
		cost += source.tools.length - 1;
		open += source.tools.length;
	};
	for (const source of bySize) {
		if (remembered.has(source.key) && open + source.tools.length <= EXTERNAL_HARD_CAP) {
			expand(source);
		}
	}
	for (const source of bySize) {
		if (!expanded.has(source.key) && cost - 1 + source.tools.length <= budget) {
			expand(source);
		}
	}
	const dropped = new Set<string>();
	for (const source of bySize.filter(s => !expanded.has(s.key)).reverse()) {
		if (sources.length - dropped.size <= budget) {
			break;
		}
		dropped.add(source.key);
	}
	return {
		expanded: sources.filter(s => expanded.has(s.key)),
		collapsed: sources.filter(s => !expanded.has(s.key) && !dropped.has(s.key)),
		dropped: sources.filter(s => dropped.has(s.key))
	};
}

export interface OfferedExternal {
	readonly tools: vscode.LanguageModelChatTool[];
	/** The name offered to the model → the registered name to invoke, where they differ. */
	readonly realNames: ReadonlyMap<string, string>;
	/** A group tool's name → the source it opens. */
	readonly groups: ReadonlyMap<string, ExternalSource>;
	/** Tools left out: a name no provider would take even renamed, or one already in use. */
	readonly skipped: string[];
}

/**
 * The tool list for the external sources: the opened ones' tools (renamed where a provider
 * would reject the name), one group tool for each closed one, nothing for a dropped one.
 * `taken` holds the names already offered, so nothing collides with Sirius's or the
 * workbench's tools.
 */
export function offerExternal(sources: readonly ExternalSource[], opened: ReadonlySet<string>, dropped: ReadonlySet<string>, taken: ReadonlySet<string>): OfferedExternal {
	const tools: vscode.LanguageModelChatTool[] = [];
	const realNames = new Map<string, string>();
	const groups = new Map<string, ExternalSource>();
	const skipped: string[] = [];
	const names = new Set(taken);
	const claim = (name: string): boolean => {
		if (names.has(name)) {
			return false;
		}
		names.add(name);
		return true;
	};
	for (const source of sources) {
		if (dropped.has(source.key)) {
			continue;
		}
		if (opened.has(source.key)) {
			for (const tool of source.tools) {
				const name = TOOL_NAME.test(tool.name) ? tool.name : tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
				if (!TOOL_NAME.test(name) || !claim(name)) {
					skipped.push(tool.name);
					continue;
				}
				tools.push({ name, description: tool.description, inputSchema: tool.inputSchema });
				if (name !== tool.name) {
					realNames.set(name, tool.name);
				}
			}
		} else {
			const base = GROUP_PREFIX + slug(source.label);
			let name = base;
			for (let i = 2; !claim(name); i++) {
				name = `${base}_${i}`;
			}
			tools.push({ name, description: groupDescription(source), inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
			groups.set(name, source);
		}
	}
	return { tools, realNames, groups, skipped };
}

/** What the model is told when it opens a group. */
export function activationResult(source: ExternalSource): string {
	const instructions = serverInstructions(source);
	return `The ${source.label} tools are open now: ${source.tools.map(tool => tool.name).join(', ')}. Call them directly.` +
		(instructions ? `\n\n${instructions}` : '');
}

/** An MCP server's instructions, for the preamble or the activation result. */
export function serverInstructions(source: ExternalSource): string | undefined {
	const text = source.instructions?.trim();
	return text
		? `Instructions from the ${source.label} MCP server — follow them when using its tools:\n${text.slice(0, MAX_SERVER_INSTRUCTIONS_CHARS)}`
		: undefined;
}

/**
 * The sources the model opened in this conversation, as the last Sirius response recorded
 * them in its result metadata.
 */
export function rememberedExpansions(history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): Set<string> {
	for (let i = history.length - 1; i >= 0; i--) {
		const turn = history[i];
		if (turn instanceof vscode.ChatResponseTurn) {
			const keys = (turn.result.metadata as { siriusExpanded?: unknown } | undefined)?.siriusExpanded;
			if (Array.isArray(keys)) {
				return new Set(keys.filter((key): key is string => typeof key === 'string'));
			}
		}
	}
	return new Set();
}

/** One line for the log: what is open, closed and left out. */
export function describeOffer(sources: readonly ExternalSource[], opened: ReadonlySet<string>, dropped: ReadonlySet<string>): string {
	const name = (source: ExternalSource): string => `${source.label}(${source.tools.length})`;
	const open = sources.filter(s => opened.has(s.key)).map(name);
	const closed = sources.filter(s => !opened.has(s.key) && !dropped.has(s.key)).map(name);
	const out = sources.filter(s => dropped.has(s.key)).map(name);
	return `open=[${open.join(',')}] closed=[${closed.join(',')}] dropped=[${out.join(',')}]`;
}

function slug(label: string): string {
	return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'tools';
}

function groupDescription(source: ExternalSource): string {
	const what = source.kind === 'mcp' ? 'MCP server' : 'extension';
	const head = `Opens the ${source.tools.length} tools of the ${source.label} ${what} for the rest of this conversation — call this first, then call them directly. They are: `;
	const items = source.tools.map(tool => `${tool.name} (${firstSentence(tool.description)})`);
	let list = '';
	for (const [i, item] of items.entries()) {
		if (list.length + item.length > MAX_GROUP_DESCRIPTION_CHARS) {
			list += ` …and ${items.length - i} more`;
			break;
		}
		list += (i ? '; ' : '') + item;
	}
	return `${head}${list}.`;
}

function firstSentence(text: string): string {
	const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? '';
	return sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence;
}
