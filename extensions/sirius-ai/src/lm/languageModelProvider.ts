/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Language Model Provider Bridge
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatMessage, IAIProvider, ImagePart, ProviderType, SiriusModel, ToolCallRequest, ToolCallResult, ToolDefinition } from '../types';
import { ModelRouter } from '../providers/modelRouter';
import { PROVIDER_LABELS } from '../auth/secretStore';
import { LOCAL_PROVIDERS, ProviderConnection, rememberConnection, rememberModel, vendorOf } from './vendors';

/**
 * Discovery is fanned out across every configured provider, so one unreachable
 * endpoint — a local server that is not running, a gateway that is slow — must
 * not stall the model picker for the rest.
 */
const DISCOVERY_TIMEOUT_MS = 4000;

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
 * The model information handed to the editor. The editor keeps the object and passes it
 * back with every request, so it carries what that request needs: which provider, which
 * configured connection (key and endpoint), and what discovery learnt about the model.
 */
interface SiriusModelInformation extends vscode.LanguageModelChatInformation {
	readonly sirius: {
		readonly provider: ProviderType;
		readonly connection: ProviderConnection | undefined;
		readonly model: SiriusModel;
	};
}

/** A configured provider group's values, as the editor resolves them (the key from the keyring). */
function toConnection(configuration: Record<string, unknown> | undefined): ProviderConnection | undefined {
	if (!configuration) {
		return undefined;
	}
	const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
	return { apiKey: text(configuration.apiKey), url: text(configuration.url) };
}

/**
 * One Sirius provider, exposed through the editor's own language-model API.
 *
 * This is the seam Copilot Chat plugs into, and it is stable API at this fork
 * point. Registering here means upstream's chat view, agent mode, inline chat,
 * multi-file editing with checkpoints and MCP tools all start working against
 * Claude, Gemini, GPT, Ollama and everything else Sirius can reach — instead of
 * being reimplemented in a bespoke webview that has to be maintained forever.
 *
 * The editor asks each vendor once with no configuration and once per configured
 * provider group. A hosted provider answers only for a group — its key lives there; a
 * local server also answers unconfigured, at its usual port, so Ollama users configure
 * nothing. A configured group is checked first, and a rejected key or a server that does
 * not answer is thrown: the Language Models editor shows it as that provider's red row.
 */
export class SiriusLanguageModelProvider implements vscode.LanguageModelChatProvider<SiriusModelInformation> {

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	/** One instance per connection, so a provider's caches (Ollama's model sizes) outlive one call. */
	private readonly _instances = new Map<string, IAIProvider>();

	constructor(private readonly router: ModelRouter, readonly providerId: ProviderType) { }

	get vendor(): string {
		return vendorOf(this.providerId);
	}

	/** Re-advertise models, e.g. after a setting changed or a local server started. */
	refresh(): void {
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private _instance(connection: ProviderConnection | undefined): IAIProvider {
		const key = JSON.stringify(connection ?? {});
		let instance = this._instances.get(key);
		if (!instance) {
			instance = this.router.createProvider(this.providerId, connection);
			this._instances.set(key, instance);
		}
		return instance;
	}

	// ─── Model discovery ─────────────────────────────────────────────────────

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken
	): Promise<SiriusModelInformation[]> {
		const connection = toConnection((options as { configuration?: Record<string, unknown> }).configuration);
		if (!connection && !LOCAL_PROVIDERS.has(this.providerId)) {
			return []; // a hosted provider, or Custom, is nothing until it is configured
		}
		const provider = this._instance(connection);

		if (connection) {
			rememberConnection(this.providerId, connection);
			const check = await provider.checkConnection();
			if (!check.ok) {
				throw new Error(check.problem);
			}
		}

		// Discovery runs even in silent mode. `silent` means "do not prompt the
		// user for credentials", and discovery never prompts.
		const discovered = await withTimeout(provider.getAvailableModels().catch(() => [] as SiriusModel[]), DISCOVERY_TIMEOUT_MS, [] as SiriusModel[]);
		if (token.isCancellationRequested) {
			return [];
		}
		// Image-generation models cannot chat. Offering them put two Imagen entries
		// in the editor's model picker that failed on the first message.
		const models = (discovered.length > 0 ? discovered : provider.models).filter(model => !model.supportsImageGen);

		const config = vscode.workspace.getConfiguration('sirius.ai');
		const isDefaultProvider = config.get<string>('defaultProvider', '') === this.providerId;
		const wanted = config.get<string>('defaultModel', '');
		const defaultId = isDefaultProvider ? (models.find(model => model.id === wanted) ?? models[0])?.id : undefined;

		// The walkthrough's "Connect a model" step completes on this: a model is
		// reachable, through a configured provider or a local runtime.
		if (models.length > 0) {
			void vscode.commands.executeCommand('setContext', 'sirius.ai.modelAvailable', true);
		}

		return models.map(model => {
			rememberModel(this.vendor, model);
			return this._describe(model, connection, model.id === defaultId);
		});
	}

	private _describe(model: SiriusModel, connection: ProviderConnection | undefined, isDefault: boolean): SiriusModelInformation {
		return {
			id: model.id,
			name: model.name,
			// Family drives model selectors, so it names the provider rather than
			// the model — `family: 'anthropic'` should match every Claude model.
			family: this.providerId,
			version: '1.0.0',
			maxInputTokens: model.contextWindow,
			maxOutputTokens: model.maxOutputTokens ?? 8192,
			tooltip: model.description,
			// A configured group's name stands in when there is no detail, so two
			// OpenAI-compatible servers stay apart; a local default shows the provider.
			detail: connection ? undefined : PROVIDER_LABELS[this.providerId],
			// Without this a model is known to the editor but never offered in the
			// chat model picker.
			isUserSelectable: true,
			isDefault,
			capabilities: {
				imageInput: model.supportsVision,
				toolCalling: true
			},
			sirius: { provider: this.providerId, connection, model }
		};
	}

	// ─── Requests ────────────────────────────────────────────────────────────

	async provideLanguageModelChatResponse(
		model: SiriusModelInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const converted = withVisionGuard(this._toChatMessages(messages), model.capabilities?.imageInput === true);
		const tools = this._toToolDefinitions(options.tools);
		const provider = this._instance(model.sirius.connection);

		for await (const chunk of this.router.chatWithModel(provider, model.sirius.model, converted, tools)) {
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
	 * the providers already expect, so it goes through whole: an MCP server's
	 * schema may put its types in `$defs` and point at them with `$ref`, and
	 * keeping only `properties` left those references dangling. A tool without a
	 * schema is given an empty object one, since every provider requires the
	 * field to be present.
	 */
	private _toToolDefinitions(tools: readonly vscode.LanguageModelChatTool[] | undefined): ToolDefinition[] | undefined {
		if (!tools?.length) {
			return undefined;
		}

		return tools.map(tool => {
			const schema = (tool.inputSchema ?? {}) as Partial<ToolDefinition['inputSchema']>;
			return {
				name: tool.name,
				description: tool.description,
				inputSchema: {
					...schema,
					type: 'object' as const,
					properties: schema.properties ?? {}
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
