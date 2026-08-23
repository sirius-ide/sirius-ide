/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Multi-Model AI Provider Interface
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// ─── Thinking / Effort ───────────────────────────────────────────────────────

/**
 * How much reasoning to spend before answering.
 *
 * These are the levels the Anthropic API actually accepts in
 * `output_config.effort`. `xhigh` sits between `high` and `max` and is the
 * best default for coding and agentic work on current models.
 */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Thinking configuration sent alongside chat requests
 */
export interface ThinkingConfig {
	enabled: boolean;
	effort: ThinkingEffort;
}

// ─── Models ──────────────────────────────────────────────────────────────────

/**
 * Supported AI providers
 */
export type ProviderType = 'gemini' | 'anthropic' | 'openai' | 'ollama';

/**
 * Represents a single AI model from any provider
 */
export interface SiriusModel {
	id: string;
	name: string;
	provider: ProviderType;
	contextWindow: number;
	description: string;
	supportsStreaming: boolean;
	supportsVision: boolean;
	supportsThinking: boolean;
	supportsImageGen: boolean;
	/** Maximum output tokens (some thinking models need higher limits) */
	maxOutputTokens?: number;
	/** Whether this model is deprecated and should show a warning */
	deprecated?: boolean;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * A tool the model may call. `inputSchema` is JSON Schema and is passed to each
 * provider in whatever wrapper that provider expects.
 */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * A call the model asked for. `id` is provider-assigned and must be echoed back
 * with the result so the model can match them up.
 */
export interface ToolCallRequest {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/** The outcome of running a tool, returned to the model on the next turn. */
export interface ToolCallResult {
	id: string;
	name: string;
	content: string;
	isError?: boolean;
}

/** Why the model stopped generating. */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'error';

// ─── Chat Messages ───────────────────────────────────────────────────────────

/**
 * A single message in a chat conversation
 */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	timestamp: number;
	/** Optional thinking content (model's internal reasoning) */
	thinking?: string;
	/** Optional image URL for image generation results */
	imageUrl?: string;
	/** Tool calls this assistant turn asked for. */
	toolCalls?: ToolCallRequest[];
	/** Results carried by a `tool` message, answering an earlier assistant turn. */
	toolResults?: ToolCallResult[];
}

/**
 * Request to send to an AI provider
 */
export interface ChatRequest {
	messages: ChatMessage[];
	model: string;
	maxTokens: number;
	temperature: number;
	stream: boolean;
	systemPrompt?: string;
	/** Thinking/reasoning configuration */
	thinking?: ThinkingConfig;
	/** Tools the model may call this turn. Omitted when tool use is disabled. */
	tools?: ToolDefinition[];
}

/**
 * A chunk of streamed response
 */
export interface ChatChunk {
	content: string;
	done: boolean;
	/** Model's internal thinking/reasoning (separate from output) */
	thinking?: string;
	/** Whether this chunk is part of a thinking block */
	isThinkingBlock?: boolean;
	/** Image data (base64 or URL) for image generation */
	imageData?: string;
	/** Tool calls the model requested. Only set on the final chunk of a turn. */
	toolCalls?: ToolCallRequest[];
	/** Why the model stopped. `tool_use` means it is waiting on tool results. */
	stopReason?: StopReason;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		/** Tokens used for thinking/reasoning */
		thinkingTokens?: number;
	};
}

// ─── Image Generation ────────────────────────────────────────────────────────

/**
 * Request for image generation
 */
export interface ImageGenRequest {
	prompt: string;
	/** Number of images to generate (1-4) */
	count?: number;
	/** Image dimensions */
	size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
	/** Style preference */
	style?: 'natural' | 'vivid';
}

/**
 * Result from image generation
 */
export interface ImageGenResult {
	images: Array<{
		base64: string;
		mimeType: string;
	}>;
	revisedPrompt?: string;
}

// ─── Workspace Context ───────────────────────────────────────────────────────

/**
 * Types of context that can be injected into chat
 */
export type ContextType = 'file' | 'selection' | 'workspace' | 'terminal' | 'errors' | 'git';

/**
 * A block of workspace context to inject into a message
 */
export interface ContextBlock {
	type: ContextType;
	label: string;
	content: string;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

/**
 * Interface that all AI providers must implement
 */
export interface IAIProvider {
	readonly id: ProviderType;
	readonly name: string;
	readonly models: SiriusModel[];

	/**
	 * Check if this provider is configured (API key set, etc.)
	 */
	isConfigured(): boolean;

	/**
	 * Validate the API key / connection
	 */
	validateConnection(): Promise<boolean>;

	/**
	 * Send a chat request and get streaming response
	 */
	chat(request: ChatRequest): AsyncIterable<ChatChunk>;

	/**
	 * Get available models (for Ollama, this queries the running instance)
	 */
	getAvailableModels(): Promise<SiriusModel[]>;

	/**
	 * Generate images (optional — only Gemini supports this natively)
	 */
	generateImage?(request: ImageGenRequest): Promise<ImageGenResult>;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

/**
 * Provider-agnostic system prompt for code assistance
 */
export const SIRIUS_SYSTEM_PROMPT = `You are Sirius AI, a powerful multi-model coding assistant built into Sirius IDE. You help developers write, understand, debug, and improve their code.

Guidelines:
- Provide clear, concise, and accurate responses
- When showing code, always use proper syntax highlighting with language identifiers
- Explain your reasoning when making suggestions
- If you're unsure about something, say so
- When fixing bugs, explain what was wrong and why your fix works
- Prefer modern, idiomatic code patterns
- Consider performance, security, and maintainability in your suggestions
- When suggesting code changes, wrap them in proper code blocks with the language specified
- For file modifications, show the complete updated function/section, not just fragments

You have access to the user's workspace context including open files, selections, terminal output, diagnostics, and git status. Use this context to provide relevant, targeted assistance.`;
