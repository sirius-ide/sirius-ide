/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Language Model Provider Bridge
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatMessage, ImagePart, ProviderType, SiriusModel, ToolCallRequest, ToolCallResult, ToolDefinition } from '../types';
import { ModelRouter } from '../providers/modelRouter';

/** The vendor Sirius registers under. Must match `languageModelChatProviders` in package.json. */
export const SIRIUS_VENDOR = 'sirius';

/**
 * Discovery is fanned out across every configured provider, so one unreachable
 * endpoint — a local server that is not running, a gateway that is slow — must
 * not stall the model picker for the rest.
 */
const DISCOVERY_TIMEOUT_MS = 4000;

/**
 * Order providers appear as groups in the model picker. Anything unlisted sorts
 * after these.
 */
const CATEGORY_ORDER: readonly ProviderType[] = [
	'anthropic', 'gemini', 'openai', 'openrouter', 'groq',
	'deepseek', 'mistral', 'xai', 'ollama', 'lmstudio', 'llamacpp', 'custom'
];

/** Resolve with `fallback` if the work has not finished in time. */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/**
 * Model ids must be unique across the whole provider, and twelve providers can
 * easily serve the same name — OpenRouter and Groq both offer Llama, Ollama and
 * LM Studio both offer Qwen. Namespacing by provider keeps them distinct and
 * lets a request resolve its provider without searching.
 */
function toLmId(provider: ProviderType, modelId: string): string {
	return `${provider}/${modelId}`;
}

export function fromLmId(id: string): { provider: ProviderType; modelId: string } {
	const slash = id.indexOf('/');
	if (slash === -1) {
		return { provider: 'ollama', modelId: id };
	}
	return {
		provider: id.slice(0, slash) as ProviderType,
		modelId: id.slice(slash + 1)
	};
}

/**
 * Exposes every Sirius provider through the editor's own language-model API.
 *
 * This is the seam Copilot Chat plugs into, and it is stable API at this fork
 * point. Registering here means upstream's chat view, agent mode, inline chat,
 * multi-file editing with checkpoints and MCP tools all start working against
 * Claude, Gemini, GPT, Ollama and everything else Sirius can reach — instead of
 * being reimplemented in a bespoke webview that has to be maintained forever.
 */
export class SiriusLanguageModelProvider implements vscode.LanguageModelChatProvider {

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	constructor(private readonly router: ModelRouter) { }

	/** Re-advertise models, e.g. after a key is added or a local server starts. */
	refresh(): void {
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	/**
	 * Every model the editor was last told about, by its lm id.
	 *
	 * The router only knows the static lists; local runtimes are discovered here
	 * and nowhere else, so this is the one place a discovered Ollama model's
	 * `sizeBytes` can be looked up afterwards. The agent uses it to pick a tool
	 * tier — the context window alone cannot tell a 1.5B from a 32B.
	 */
	private readonly _known = new Map<string, SiriusModel>();

	getKnownModel(lmId: string): SiriusModel | undefined {
		return this._known.get(lmId);
	}

	// ─── Model discovery ─────────────────────────────────────────────────────

	async provideLanguageModelChatInformation(
		_options: { readonly silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		const providers = this.router.getConfiguredProviders();

		// Discovery runs even in silent mode. `silent` means "do not prompt the
		// user for credentials", and discovery never prompts — it only uses keys
		// already stored. Skipping it would hide every local runtime, since Ollama
		// and LM Studio have no static model list at all and are entirely
		// discovered.
		const resolved = await Promise.all(providers.map(async provider => {
			const discovered = await withTimeout(
				provider.getAvailableModels().catch(() => [] as SiriusModel[]),
				DISCOVERY_TIMEOUT_MS,
				[] as SiriusModel[]
			);
			return {
				provider,
				models: discovered.length > 0 ? discovered : provider.models
			};
		}));

		if (token.isCancellationRequested) {
			return [];
		}

		this._known.clear();
		const described = resolved.flatMap(({ provider, models }) =>
			models.map(model => {
				this._known.set(toLmId(provider.id, model.id), model);
				return this._describe(provider.id, provider.name, model);
			})
		);

		// The panel's "Auto" resolves to whichever model is marked default; with
		// none marked, every auto-routed request dies with "Language model
		// unavailable". Prefer the configured default, else the first model.
		if (described.length > 0) {
			const config = vscode.workspace.getConfiguration('sirius.ai');
			const wantedModel = config.get<string>('defaultModel', '');
			const wantedProvider = config.get<string>('defaultProvider', '');
			const pick =
				described.find(m => m.id.endsWith(`/${wantedModel}`)) ??
				described.find(m => m.id.startsWith(`${wantedProvider}/`)) ??
				described[0];
			const index = described.indexOf(pick);
			described[index] = { ...pick, isDefault: true };
		}

		return described;
	}

	private _describe(providerId: ProviderType, providerName: string, model: SiriusModel): vscode.LanguageModelChatInformation {
		const order = CATEGORY_ORDER.indexOf(providerId);

		return {
			id: toLmId(providerId, model.id),
			name: model.name,
			// Family drives model selectors, so it names the provider rather than
			// the model — `family: 'anthropic'` should match every Claude model.
			family: providerId,
			version: '1.0.0',
			maxInputTokens: model.contextWindow,
			maxOutputTokens: model.maxOutputTokens ?? 8192,
			tooltip: model.description,
			detail: providerName,
			// Without this a model is known to the editor but never offered in the
			// chat model picker, which then renders an inert "Auto" entry because
			// it believes no models exist.
			isUserSelectable: true,
			// Group by provider, so twelve providers stay navigable.
			category: {
				label: providerName,
				order: order === -1 ? CATEGORY_ORDER.length : order
			},
			capabilities: {
				imageInput: model.supportsVision,
				toolCalling: true
			}
		};
	}

	// ─── Requests ────────────────────────────────────────────────────────────

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const { provider, modelId } = fromLmId(model.id);
		const converted = withVisionGuard(this._toChatMessages(messages), model.capabilities?.imageInput === true);
		const tools = this._toToolDefinitions(options.tools);

		for await (const chunk of this.router.chatWithProvider(provider, modelId, converted, tools)) {
			if (token.isCancellationRequested) {
				return;
			}

			if (chunk.thinking) {
				// Proposed API; the extension host accepts it from a provider.
				progress.report(new vscode.LanguageModelThinkingPart(chunk.thinking) as unknown as vscode.LanguageModelResponsePart);
			}

			if (chunk.content) {
				progress.report(new vscode.LanguageModelTextPart(chunk.content));
			}

			for (const call of chunk.toolCalls ?? []) {
				progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, call.arguments));
			}
		}
	}

	/**
	 * The editor's tools carry JSON Schema in `inputSchema`, which is exactly what
	 * the providers already expect. A tool without a schema is given an empty
	 * object one, since every provider requires the field to be present.
	 */
	private _toToolDefinitions(tools: readonly vscode.LanguageModelChatTool[] | undefined): ToolDefinition[] | undefined {
		if (!tools?.length) {
			return undefined;
		}

		return tools.map(tool => {
			const schema = (tool.inputSchema ?? {}) as ToolDefinition['inputSchema'];
			return {
				name: tool.name,
				description: tool.description,
				inputSchema: {
					type: 'object' as const,
					properties: schema.properties ?? {},
					...(schema.required ? { required: schema.required } : {})
				}
			};
		});
	}

	/**
	 * Convert the editor's message parts into Sirius messages.
	 *
	 * The editor sends tool results on a *User* message rather than a dedicated
	 * role, so those turns become our `tool` role. Result parts carry only a
	 * callId, while several providers need the tool's name back — Ollama keys on
	 * `tool_name` and Gemini on `functionResponse.name` — so names are remembered
	 * from the assistant turn that requested them.
	 */
	private _toChatMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
		const converted: ChatMessage[] = [];
		const toolNames = new Map<string, string>();
		const timestamp = Date.now();

		for (const message of messages) {
			const isAssistant = message.role === vscode.LanguageModelChatMessageRole.Assistant;
			let text = '';
			const images: ImagePart[] = [];
			const toolCalls: ToolCallRequest[] = [];
			const toolResults: ToolCallResult[] = [];

			for (const part of message.content) {
				if (isToolCallPart(part)) {
					toolNames.set(part.callId, part.name);
					toolCalls.push({ id: part.callId, name: part.name, arguments: part.input as Record<string, unknown> });
				} else if (isToolResultPart(part)) {
					const flattened = flattenResultContent(part.content);
					toolResults.push({
						id: part.callId,
						name: toolNames.get(part.callId) ?? '',
						content: flattened.text,
						...(flattened.images.length ? { images: flattened.images } : {})
					});
				} else if (isTextPart(part)) {
					text += part.value;
				} else if (isImageDataPart(part)) {
					images.push(toImagePart(part));
				}
			}

			if (toolResults.length > 0) {
				converted.push({ role: 'tool', content: '', timestamp, toolResults });
			}

			if (toolCalls.length > 0) {
				converted.push({ role: 'assistant', content: text, timestamp, toolCalls });
			} else if (text || images.length) {
				// An image-only turn is legitimate — a pasted screenshot with no
				// words — so presence of either is enough to emit the message.
				converted.push({
					role: isAssistant ? 'assistant' : 'user',
					content: text,
					timestamp,
					...(images.length ? { images } : {})
				});
			}
		}

		return converted;
	}

	// ─── Token counting ──────────────────────────────────────────────────────

	/**
	 * An approximation. The editor calls this often — for every attachment and on
	 * every keystroke in some flows — so it has to be synchronous work. Asking a
	 * provider for an exact count would be a network round trip each time.
	 */
	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		const content = typeof text === 'string'
			? text
			: text.content.map(part => (isTextPart(part) ? part.value : '')).join('');

		// Roughly four characters per token across the tokenizers in use here.
		return Math.ceil(content.length / 4);
	}
}

// ─── Vision guard ────────────────────────────────────────────────────────────

/**
 * Keep images only for models that can see them.
 *
 * Most local models are text-only. Sending them an image block is at best a
 * provider error and at worst silently ignored, so the model answers as if the
 * user attached nothing. Replacing each image with a short note is the honest
 * degradation: the model knows something was attached and can say it cannot
 * view it, rather than confidently describing a screenshot it never received.
 */
function withVisionGuard(messages: ChatMessage[], canSee: boolean): ChatMessage[] {
	if (canSee) {
		return messages;
	}
	return messages.map(message => {
		const { images, toolResults, ...rest } = message;
		const note = (count: number) =>
			`\n[${count} image${count === 1 ? '' : 's'} attached — this model cannot view images]`;
		const stripped: ChatMessage = { ...rest };
		if (images?.length) {
			stripped.content = (message.content + note(images.length)).trim();
		}
		if (toolResults) {
			stripped.toolResults = toolResults.map(result => {
				const { images: resultImages, ...resultRest } = result;
				return resultImages?.length
					? { ...resultRest, content: (result.content + note(resultImages.length)).trim() }
					: resultRest;
			});
		}
		return stripped;
	});
}

// ─── Part predicates ─────────────────────────────────────────────────────────
//
// Parts arrive across the extension-host boundary, so they are matched on shape
// rather than by `instanceof`, which is brittle across realms.

function isTextPart(part: unknown): part is vscode.LanguageModelTextPart {
	return typeof part === 'object' && part !== null
		&& typeof (part as vscode.LanguageModelTextPart).value === 'string';
}

function isToolCallPart(part: unknown): part is vscode.LanguageModelToolCallPart {
	if (typeof part !== 'object' || part === null) {
		return false;
	}
	const candidate = part as vscode.LanguageModelToolCallPart;
	return typeof candidate.callId === 'string' && typeof candidate.name === 'string' && candidate.input !== undefined;
}

function isToolResultPart(part: unknown): part is vscode.LanguageModelToolResultPart {
	if (typeof part !== 'object' || part === null) {
		return false;
	}
	const candidate = part as vscode.LanguageModelToolResultPart;
	return typeof candidate.callId === 'string' && Array.isArray(candidate.content);
}

/**
 * An image arriving from the editor as a `LanguageModelDataPart`.
 *
 * Matched on shape, like the other predicates — these cross the extension-host
 * boundary, so `instanceof` is unreliable across realms. `data` survives that
 * crossing as a Uint8Array or as an array-like of bytes depending on the host,
 * so the check stays deliberately loose and the decode below handles both.
 */
function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	if (typeof part !== 'object' || part === null) {
		return false;
	}
	const candidate = part as vscode.LanguageModelDataPart;
	return typeof candidate.mimeType === 'string'
		&& candidate.mimeType.startsWith('image/')
		&& candidate.data !== undefined && candidate.data !== null;
}

/** Decode a data part's bytes to base64 without assuming which shape survived. */
function toImagePart(part: vscode.LanguageModelDataPart): ImagePart {
	const raw = part.data as unknown;
	const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayLike<number>);
	return { base64: Buffer.from(bytes).toString('base64'), mimeType: part.mimeType };
}

/**
 * Tool results are themselves an array of parts. Text is concatenated; images
 * are carried out separately so a screenshot tool's output can actually reach a
 * vision model instead of being silently discarded.
 */
function flattenResultContent(content: readonly unknown[]): { text: string; images: ImagePart[] } {
	let text = '';
	const images: ImagePart[] = [];
	for (const part of content) {
		if (isTextPart(part)) {
			text += part.value;
		} else if (isImageDataPart(part)) {
			images.push(toImagePart(part));
		}
	}
	return { text: text.trim(), images };
}
