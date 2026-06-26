/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — AI Chat Webview Panel (Enhanced)
 *  Copyright (c) Arshad Siddiqui. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModelRouter, PROVIDER_COLORS } from '../providers/modelRouter';
import { SiriusModel, SIRIUS_SYSTEM_PROMPT, ProviderType } from '../types';
import { WorkspaceContextEngine } from '../context/contextEngine';
import { SiriusCodeActions } from '../actions/codeActions';
import { SiriusToolExecutor } from '../tools/toolExecutor';

interface ChatEntry {
	role: 'user' | 'assistant';
	content: string;
	thinking?: string;
	model?: string;
	timestamp: number;
}

export class SiriusChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'sirius.ai.chatView';
	private _view?: vscode.WebviewView;
	private chatHistory: ChatEntry[] = [];
	private contextEngine: WorkspaceContextEngine;
	private codeActions: SiriusCodeActions;
	private toolExecutor: SiriusToolExecutor;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly modelRouter: ModelRouter
	) {
		this.contextEngine = new WorkspaceContextEngine();
		this.codeActions = new SiriusCodeActions();
		this.toolExecutor = new SiriusToolExecutor();
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = this._getHtml(webviewView.webview);

		// Send initial state
		const model = this.modelRouter.getDefaultModel();
		const thinking = this.modelRouter.getThinkingConfig();
		const color = PROVIDER_COLORS[model.provider];
		webviewView.webview.postMessage({
			type: 'init',
			model: model.name,
			modelId: model.id,
			provider: model.provider,
			providerColor: color,
			supportsThinking: model.supportsThinking,
			supportsImageGen: model.supportsImageGen,
			thinkingEnabled: thinking.enabled,
			thinkingEffort: thinking.effort
		});

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'sendMessage':
					await this._handleUserMessage(message.text);
					break;
				case 'selectModel':
					const selected = await this.modelRouter.selectModel();
					if (selected && this._view) {
						const clr = PROVIDER_COLORS[selected.provider];
						this._view.webview.postMessage({
							type: 'init',
							model: selected.name,
							modelId: selected.id,
							provider: selected.provider,
							providerColor: clr,
							supportsThinking: selected.supportsThinking,
							supportsImageGen: selected.supportsImageGen,
							thinkingEnabled: this.modelRouter.getThinkingConfig().enabled,
							thinkingEffort: this.modelRouter.getThinkingConfig().effort
						});
					}
					break;
				case 'toggleThinking':
					const config = vscode.workspace.getConfiguration('sirius.ai.thinking');
					const current = config.get<boolean>('enabled', true);
					await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
					this._view?.webview.postMessage({ type: 'thinkingToggled', enabled: !current });
					break;
				case 'setEffort':
					await vscode.workspace.getConfiguration('sirius.ai.thinking')
						.update('effort', message.effort, vscode.ConfigurationTarget.Global);
					break;
				case 'clearChat':
					this.chatHistory = [];
					break;
				case 'setApiKey':
					await this.modelRouter.setApiKey();
					break;
				case 'applyCode':
					await this.codeActions.applyCode(message.code, message.language || '');
					break;
				case 'insertCode':
					await this.codeActions.insertAtCursor(message.code);
					break;
				case 'copyCode':
					await this.codeActions.copyToClipboard(message.code);
					break;
				case 'newFile':
					await this.codeActions.createNewFile(message.code, message.language || 'plaintext');
					break;
				case 'generateImage':
					await this._handleImageGeneration(message.prompt);
					break;
			}
		});

		// Listen for model changes
		this.modelRouter.onModelChanged((model) => {
			if (this._view) {
				const clr = PROVIDER_COLORS[model.provider];
				this._view.webview.postMessage({
					type: 'init',
					model: model.name,
					modelId: model.id,
					provider: model.provider,
					providerColor: clr,
					supportsThinking: model.supportsThinking,
					supportsImageGen: model.supportsImageGen,
					thinkingEnabled: this.modelRouter.getThinkingConfig().enabled,
					thinkingEffort: this.modelRouter.getThinkingConfig().effort
				});
			}
		});
	}

	private async _handleUserMessage(text: string): Promise<void> {
		if (!this._view) { return; }

		// Resolve context tags
		const { cleanText, context } = await this.contextEngine.resolveContextTags(text);
		const contextStr = this.contextEngine.formatContextBlocks(context);
		const fullMessage = (cleanText + contextStr).trim();

		// Add user message to history
		this.chatHistory.push({ role: 'user', content: fullMessage, timestamp: Date.now() });

		// Start streaming
		this._view.webview.postMessage({ type: 'streamStart' });

		// Build conversation
		const messages = this.chatHistory.map(m => ({ role: m.role, content: m.content }));

		let fullResponse = '';
		let thinkingContent = '';

		try {
			for await (const chunk of this.modelRouter.chat(messages)) {
				// Handle thinking content
				if (chunk.thinking) {
					thinkingContent += chunk.thinking;
					this._view.webview.postMessage({
						type: 'thinkingChunk',
						content: chunk.thinking,
						isStart: chunk.isThinkingBlock
					});
					continue;
				}

				if (chunk.content) {
					fullResponse += chunk.content;
					this._view.webview.postMessage({ type: 'streamChunk', content: chunk.content });
				}

				if (chunk.done) {
					// Check for tool calls in the response
					const toolCalls = this.toolExecutor.parseToolCalls(fullResponse);
					if (toolCalls.length > 0) {
						await this._executeToolCalls(toolCalls, fullResponse);
					}

					const model = this.modelRouter.getDefaultModel();
					this.chatHistory.push({
						role: 'assistant',
						content: fullResponse,
						thinking: thinkingContent || undefined,
						model: model.id,
						timestamp: Date.now()
					});

					this._view.webview.postMessage({
						type: 'streamEnd',
						usage: chunk.usage
					});
				}
			}
		} catch (error: any) {
			this._view.webview.postMessage({ type: 'streamChunk', content: `\n\n⚠️ Error: ${error.message}` });
			this._view.webview.postMessage({ type: 'streamEnd' });
		}
	}

	/**
	 * Execute tool calls found in the AI response
	 */
	private async _executeToolCalls(toolCalls: { name: string; arguments: Record<string, any> }[], _responseText: string): Promise<void> {
		for (const tool of toolCalls) {
			this._view?.webview.postMessage({
				type: 'toolStart',
				tool: tool.name,
				args: tool.arguments
			});

			const result = await this.toolExecutor.execute(tool);

			this._view?.webview.postMessage({
				type: 'toolResult',
				tool: tool.name,
				success: result.success,
				output: result.output
			});
		}
	}

	/**
	 * Handle image generation requests
	 */
	private async _handleImageGeneration(prompt: string): Promise<void> {
		if (!this._view) { return; }

		this._view.webview.postMessage({ type: 'imageGenStart' });

		const result = await this.modelRouter.generateImage(prompt);
		if (result && result.images.length > 0) {
			this._view.webview.postMessage({
				type: 'imageGenResult',
				images: result.images.map(img => `data:${img.mimeType};base64,${img.base64}`),
				revisedPrompt: result.revisedPrompt
			});
		} else {
			this._view.webview.postMessage({
				type: 'imageGenResult',
				images: [],
				error: 'Failed to generate image'
			});
		}
	}

	public async sendContextAction(action: string, code: string, language: string): Promise<void> {
		if (!this._view) {
			await vscode.commands.executeCommand('sirius.ai.chatView.focus');
			await new Promise(r => setTimeout(r, 500));
		}

		const prompts: Record<string, string> = {
			'explain': `Explain this code in detail:\n\`\`\`${language}\n${code}\n\`\`\``,
			'fix': `Find and fix any bugs or errors in this code:\n\`\`\`${language}\n${code}\n\`\`\``,
			'tests': `Write comprehensive tests for this code:\n\`\`\`${language}\n${code}\n\`\`\``,
			'refactor': `Refactor this code to improve readability, performance, and maintainability:\n\`\`\`${language}\n${code}\n\`\`\``
		};

		const message = prompts[action] || `Help me with this code:\n\`\`\`${language}\n${code}\n\`\`\``;

		if (this._view) {
			this._view.webview.postMessage({ type: 'addUserMessage', content: message });
		}
		await this._handleUserMessage(message);
	}

	private _getHtml(_webview: vscode.Webview): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sirius AI</title>
<style>
:root {
	--bg: #06080d;
	--surface: #0d1117;
	--surface2: #161b22;
	--border: rgba(139, 92, 246, 0.15);
	--accent: #8b5cf6;
	--accent-glow: rgba(139, 92, 246, 0.3);
	--star: #a8c7fa;
	--cyan: #67e8f9;
	--text: #e6edf3;
	--text-dim: #8b949e;
	--success: #3fb950;
	--error: #f85149;
	--provider-color: #8b5cf6;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	background: var(--bg);
	color: var(--text);
	height: 100vh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* ── Header ────────────────────────────────────────────────────────── */
.header {
	padding: 8px 12px;
	border-bottom: 1px solid var(--border);
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: var(--surface);
	flex-shrink: 0;
	gap: 6px;
}

.header-left {
	display: flex;
	align-items: center;
	gap: 6px;
}

.star { color: var(--accent); font-size: 16px; animation: pulse-star 3s ease-in-out infinite; }
@keyframes pulse-star {
	0%, 100% { opacity: 1; text-shadow: 0 0 8px var(--accent-glow); }
	50% { opacity: 0.7; text-shadow: 0 0 16px var(--accent-glow); }
}

.header-title { font-size: 13px; font-weight: 600; color: var(--star); }

.header-actions { display: flex; gap: 4px; align-items: center; }

.model-badge {
	background: var(--surface2);
	border: 1px solid var(--provider-color);
	color: var(--provider-color);
	padding: 3px 8px;
	border-radius: 12px;
	font-size: 10px;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s;
	white-space: nowrap;
}
.model-badge:hover { background: var(--provider-color); color: white; }

.thinking-badge {
	background: var(--surface2);
	border: 1px solid var(--border);
	color: var(--text-dim);
	padding: 3px 8px;
	border-radius: 12px;
	font-size: 10px;
	cursor: pointer;
	transition: all 0.2s;
}
.thinking-badge.active { border-color: #f59e0b; color: #f59e0b; }
.thinking-badge:hover { border-color: var(--accent); }

.effort-select {
	background: var(--surface2);
	border: 1px solid var(--border);
	color: var(--text-dim);
	padding: 2px 4px;
	border-radius: 6px;
	font-size: 10px;
	outline: none;
	cursor: pointer;
}

.clear-btn {
	background: none;
	border: 1px solid var(--border);
	color: var(--text-dim);
	width: 24px;
	height: 24px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 12px;
	transition: all 0.2s;
	display: flex;
	align-items: center;
	justify-content: center;
}
.clear-btn:hover { border-color: var(--error); color: var(--error); }

/* ── Chat Area ─────────────────────────────────────────────────────── */
.chat-container {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	scroll-behavior: smooth;
}

.chat-container::-webkit-scrollbar { width: 5px; }
.chat-container::-webkit-scrollbar-track { background: transparent; }
.chat-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.message { max-width: 95%; animation: msg-in 0.25s ease-out; }
@keyframes msg-in {
	from { opacity: 0; transform: translateY(6px); }
	to { opacity: 1; transform: translateY(0); }
}

.message.user {
	align-self: flex-end;
	background: var(--accent);
	color: #fff;
	padding: 10px 14px;
	border-radius: 14px 14px 4px 14px;
	font-size: 13px;
	line-height: 1.5;
	word-break: break-word;
}

.message.assistant {
	align-self: flex-start;
	background: var(--surface);
	border: 1px solid var(--border);
	padding: 12px 14px;
	border-radius: 4px 14px 14px 14px;
	font-size: 13px;
	line-height: 1.6;
	width: 100%;
}

/* ── Thinking Block ────────────────────────────────────────────────── */
.thinking-block {
	background: rgba(245, 158, 11, 0.06);
	border: 1px solid rgba(245, 158, 11, 0.2);
	border-radius: 8px;
	margin: 8px 0;
	overflow: hidden;
	animation: think-pulse 2s ease-in-out infinite;
}
@keyframes think-pulse {
	0%, 100% { border-color: rgba(245, 158, 11, 0.2); }
	50% { border-color: rgba(245, 158, 11, 0.4); }
}
.thinking-block.done { animation: none; border-color: rgba(245, 158, 11, 0.15); }

.thinking-header {
	padding: 6px 10px;
	font-size: 11px;
	color: #f59e0b;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	user-select: none;
}
.thinking-header:hover { background: rgba(245, 158, 11, 0.08); }

.thinking-content {
	padding: 8px 10px;
	font-size: 12px;
	color: var(--text-dim);
	border-top: 1px solid rgba(245, 158, 11, 0.1);
	max-height: 200px;
	overflow-y: auto;
	white-space: pre-wrap;
	display: none;
}
.thinking-content.expanded { display: block; }

/* ── Tool Execution ────────────────────────────────────────────────── */
.tool-block {
	background: rgba(59, 130, 246, 0.06);
	border: 1px solid rgba(59, 130, 246, 0.2);
	border-radius: 8px;
	margin: 8px 0;
	padding: 8px 10px;
	font-size: 12px;
}
.tool-block .tool-name { color: #3b82f6; font-weight: 600; margin-bottom: 4px; }
.tool-block .tool-output { color: var(--text-dim); white-space: pre-wrap; max-height: 150px; overflow-y: auto; }
.tool-block.success { border-color: rgba(63, 185, 80, 0.3); }
.tool-block.failure { border-color: rgba(248, 81, 73, 0.3); }

/* ── Code Blocks ───────────────────────────────────────────────────── */
.message.assistant pre {
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 12px;
	margin: 8px 0;
	overflow-x: auto;
	font-family: 'JetBrains Mono', 'Fira Code', monospace;
	font-size: 12px;
	position: relative;
}
.message.assistant code {
	font-family: 'JetBrains Mono', 'Fira Code', monospace;
	font-size: 12px;
}
.message.assistant p { margin: 6px 0; }

.code-actions {
	position: absolute;
	top: 4px;
	right: 4px;
	display: flex;
	gap: 2px;
	opacity: 0;
	transition: opacity 0.2s;
}
.message.assistant pre:hover .code-actions { opacity: 1; }

.code-action-btn {
	background: var(--surface2);
	border: 1px solid var(--border);
	color: var(--text-dim);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 9px;
	cursor: pointer;
	transition: all 0.15s;
}
.code-action-btn:hover { background: var(--accent); color: white; border-color: var(--accent); }

/* ── Image Display ─────────────────────────────────────────────────── */
.image-result {
	margin: 8px 0;
	border-radius: 8px;
	overflow: hidden;
	border: 1px solid var(--border);
}
.image-result img {
	width: 100%;
	display: block;
	border-radius: 7px;
}
.image-result .caption { padding: 6px 10px; font-size: 11px; color: var(--text-dim); }

/* ── Typing Indicator ──────────────────────────────────────────────── */
.typing {
	display: flex;
	gap: 4px;
	padding: 12px 14px;
	align-self: flex-start;
}
.typing .dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--accent);
	animation: typing-bounce 1.4s infinite ease-in-out both;
}
.typing .dot:nth-child(1) { animation-delay: -0.32s; }
.typing .dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing-bounce {
	0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
	40% { transform: scale(1); opacity: 1; }
}

/* ── Welcome ───────────────────────────────────────────────────────── */
.welcome {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	color: var(--text-dim);
	text-align: center;
	padding: 20px;
}
.welcome .star-icon { font-size: 40px; color: var(--accent); margin-bottom: 12px; }
.welcome h3 { color: var(--star); font-size: 16px; margin-bottom: 6px; }
.welcome p { font-size: 12px; max-width: 260px; line-height: 1.5; }

.shortcuts { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 280px; }
.shortcut {
	background: var(--surface);
	border: 1px solid var(--border);
	padding: 8px 14px;
	border-radius: 8px;
	font-size: 11px;
	cursor: pointer;
	transition: all 0.2s;
	text-align: left;
}
.shortcut:hover { border-color: var(--accent); box-shadow: 0 0 12px var(--accent-glow); }

/* ── Input Area ────────────────────────────────────────────────────── */
.input-area {
	padding: 10px 12px;
	border-top: 1px solid var(--border);
	background: var(--surface);
	flex-shrink: 0;
}

.input-wrapper { display: flex; gap: 8px; align-items: flex-end; }

.input-wrapper textarea {
	flex: 1;
	background: var(--surface2);
	border: 1px solid var(--border);
	color: var(--text);
	padding: 10px 12px;
	border-radius: 10px;
	font-size: 13px;
	font-family: inherit;
	resize: none;
	max-height: 120px;
	min-height: 40px;
	outline: none;
	transition: border-color 0.2s;
}
.input-wrapper textarea:focus {
	border-color: var(--accent);
	box-shadow: 0 0 0 2px var(--accent-glow);
}
.input-wrapper textarea::placeholder { color: var(--text-dim); }

.send-btn {
	background: var(--accent);
	border: none;
	color: white;
	width: 36px;
	height: 36px;
	border-radius: 10px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s;
	flex-shrink: 0;
}
.send-btn:hover { background: #7c3aed; box-shadow: 0 0 12px var(--accent-glow); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn svg { width: 16px; height: 16px; }

.input-hints { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.hint-tag {
	font-size: 10px;
	color: var(--text-dim);
	background: var(--surface2);
	padding: 2px 8px;
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.15s;
}
.hint-tag:hover { color: var(--accent); background: rgba(139, 92, 246, 0.1); }

.usage-info { font-size: 10px; color: var(--text-dim); text-align: right; margin-top: 4px; }
</style>
</head>
<body>
<div class="header">
	<div class="header-left">
		<span class="star">★</span>
		<span class="header-title">Sirius AI</span>
	</div>
	<div class="header-actions">
		<span class="thinking-badge" id="thinkingBadge" onclick="toggleThinking()" title="Toggle Thinking Mode">🧠</span>
		<select class="effort-select" id="effortSelect" onchange="setEffort(this.value)" title="Thinking Effort">
			<option value="low">⚡ Low</option>
			<option value="medium">🔷 Med</option>
			<option value="high" selected>🔶 High</option>
			<option value="max">🔴 Max</option>
			<option value="ultra_code">💎 Ultra</option>
		</select>
		<span class="model-badge" id="modelBadge" onclick="selectModel()">Loading...</span>
		<button class="clear-btn" onclick="clearChat()" title="Clear Chat">🗑</button>
	</div>
</div>

<div class="chat-container" id="chatContainer">
	<div class="welcome" id="welcome">
		<div class="star-icon">★</div>
		<h3>Sirius AI</h3>
		<p>Multi-model AI assistant with thinking, tools, and image generation.</p>
		<div class="shortcuts">
			<div class="shortcut" onclick="quickAction('Explain this codebase structure @workspace')">📁 Explain workspace</div>
			<div class="shortcut" onclick="quickAction('Find and fix errors @errors')">🐛 Fix all errors</div>
			<div class="shortcut" onclick="quickAction('Improve this code @selection')">✨ Improve selection</div>
			<div class="shortcut" onclick="quickAction('What changed recently? @git')">📝 Git status</div>
		</div>
	</div>
</div>

<div class="input-area">
	<div class="input-wrapper">
		<textarea id="chatInput" placeholder="Ask Sirius anything..." rows="1"
			onkeydown="handleKeydown(event)" oninput="autoResize(this)"></textarea>
		<button class="send-btn" id="sendBtn" onclick="sendMessage()">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
			</svg>
		</button>
	</div>
	<div class="input-hints">
		<span class="hint-tag" onclick="insertHint('@file')">@file</span>
		<span class="hint-tag" onclick="insertHint('@selection')">@selection</span>
		<span class="hint-tag" onclick="insertHint('@workspace')">@workspace</span>
		<span class="hint-tag" onclick="insertHint('@errors')">@errors</span>
		<span class="hint-tag" onclick="insertHint('@terminal')">@terminal</span>
		<span class="hint-tag" onclick="insertHint('@git')">@git</span>
	</div>
	<div class="usage-info" id="usageInfo"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
let isStreaming = false;
let currentAssistantEl = null;
let currentResponse = '';
let currentThinkingEl = null;
let currentThinkingContent = '';
let thinkingEnabled = true;

function selectModel() { vscode.postMessage({ type: 'selectModel' }); }

function toggleThinking() {
	vscode.postMessage({ type: 'toggleThinking' });
}

function setEffort(effort) {
	vscode.postMessage({ type: 'setEffort', effort });
}

function clearChat() {
	document.getElementById('chatContainer').innerHTML = '';
	vscode.postMessage({ type: 'clearChat' });
}

function sendMessage() {
	const input = document.getElementById('chatInput');
	const text = input.value.trim();
	if (!text || isStreaming) return;

	document.getElementById('welcome')?.remove();
	addMessage('user', text);
	input.value = '';
	autoResize(input);
	vscode.postMessage({ type: 'sendMessage', text });
}

function quickAction(text) {
	document.getElementById('chatInput').value = text;
	sendMessage();
}

function insertHint(tag) {
	const input = document.getElementById('chatInput');
	input.value += ' ' + tag;
	input.focus();
}

function addMessage(role, content) {
	const container = document.getElementById('chatContainer');
	const el = document.createElement('div');
	el.className = 'message ' + role;
	if (role === 'assistant') {
		el.innerHTML = renderMarkdown(content);
	} else {
		el.textContent = content;
	}
	container.appendChild(el);
	container.scrollTop = container.scrollHeight;
	return el;
}

function renderMarkdown(text) {
	let html = text
		.replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/g, (_, lang, code) => {
			const escapedCode = code.replace(/&/g,'&amp;');
			return '<pre><code class="lang-' + lang + '">' + escapedCode + '</code>' +
				'<div class="code-actions">' +
				'<button class="code-action-btn" onclick="codeAction(\\'copy\\', this)">Copy</button>' +
				'<button class="code-action-btn" onclick="codeAction(\\'apply\\', this)">Apply</button>' +
				'<button class="code-action-btn" onclick="codeAction(\\'insert\\', this)">Insert</button>' +
				'<button class="code-action-btn" onclick="codeAction(\\'newfile\\', this)">New File</button>' +
				'</div></pre>';
		})
		.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/\\n/g, '<br>');
	return html;
}

function codeAction(action, btn) {
	const pre = btn.closest('pre');
	const code = pre.querySelector('code')?.textContent || '';
	const langClass = pre.querySelector('code')?.className || '';
	const lang = langClass.replace('lang-', '') || 'plaintext';

	switch (action) {
		case 'copy': vscode.postMessage({ type: 'copyCode', code }); break;
		case 'apply': vscode.postMessage({ type: 'applyCode', code, language: lang }); break;
		case 'insert': vscode.postMessage({ type: 'insertCode', code }); break;
		case 'newfile': vscode.postMessage({ type: 'newFile', code, language: lang }); break;
	}
}

function handleKeydown(e) {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
}

function autoResize(el) {
	el.style.height = 'auto';
	el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Handle messages from extension ───────────────────────────────────
window.addEventListener('message', (event) => {
	const msg = event.data;
	const container = document.getElementById('chatContainer');

	switch (msg.type) {
		case 'init':
			document.getElementById('modelBadge').textContent = msg.model;
			document.getElementById('modelBadge').style.borderColor = msg.providerColor;
			document.getElementById('modelBadge').style.color = msg.providerColor;
			document.documentElement.style.setProperty('--provider-color', msg.providerColor);
			thinkingEnabled = msg.thinkingEnabled;
			const badge = document.getElementById('thinkingBadge');
			badge.className = 'thinking-badge' + (msg.thinkingEnabled ? ' active' : '');
			badge.style.display = msg.supportsThinking ? '' : 'none';
			document.getElementById('effortSelect').value = msg.thinkingEffort || 'high';
			document.getElementById('effortSelect').style.display = msg.supportsThinking ? '' : 'none';
			break;

		case 'thinkingToggled':
			thinkingEnabled = msg.enabled;
			document.getElementById('thinkingBadge').className = 'thinking-badge' + (msg.enabled ? ' active' : '');
			break;

		case 'streamStart':
			isStreaming = true;
			currentResponse = '';
			currentThinkingContent = '';
			currentThinkingEl = null;
			document.getElementById('sendBtn').disabled = true;
			const typing = document.createElement('div');
			typing.className = 'typing';
			typing.id = 'typingIndicator';
			typing.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
			container.appendChild(typing);
			container.scrollTop = container.scrollHeight;
			break;

		case 'thinkingChunk':
			document.getElementById('typingIndicator')?.remove();
			currentThinkingContent += msg.content;
			if (!currentThinkingEl) {
				currentThinkingEl = document.createElement('div');
				currentThinkingEl.className = 'thinking-block';
				currentThinkingEl.innerHTML = '<div class="thinking-header" onclick="this.nextElementSibling.classList.toggle(\\'expanded\\')">🧠 Thinking...</div><div class="thinking-content">' + escapeHtml(currentThinkingContent) + '</div>';
				if (!currentAssistantEl) {
					currentAssistantEl = document.createElement('div');
					currentAssistantEl.className = 'message assistant';
					container.appendChild(currentAssistantEl);
				}
				currentAssistantEl.prepend(currentThinkingEl);
			} else {
				currentThinkingEl.querySelector('.thinking-content').textContent = currentThinkingContent;
			}
			container.scrollTop = container.scrollHeight;
			break;

		case 'streamChunk':
			document.getElementById('typingIndicator')?.remove();
			currentResponse += msg.content;
			if (!currentAssistantEl) {
				currentAssistantEl = addMessage('assistant', currentResponse);
			} else {
				// Preserve thinking block, update text content
				const thinkingBlock = currentAssistantEl.querySelector('.thinking-block');
				currentAssistantEl.innerHTML = renderMarkdown(currentResponse);
				if (thinkingBlock) { currentAssistantEl.prepend(thinkingBlock); }
			}
			container.scrollTop = container.scrollHeight;
			break;

		case 'streamEnd':
			isStreaming = false;
			if (currentThinkingEl) {
				currentThinkingEl.classList.add('done');
				const header = currentThinkingEl.querySelector('.thinking-header');
				if (header) header.textContent = '🧠 Thought process (click to expand)';
			}
			currentAssistantEl = null;
			currentThinkingEl = null;
			document.getElementById('sendBtn').disabled = false;
			document.getElementById('typingIndicator')?.remove();
			if (msg.usage) {
				let usageText = msg.usage.promptTokens + ' in / ' + msg.usage.completionTokens + ' out';
				if (msg.usage.thinkingTokens) { usageText += ' / ' + msg.usage.thinkingTokens + ' thinking'; }
				document.getElementById('usageInfo').textContent = 'Tokens: ' + usageText;
			}
			document.getElementById('chatInput').focus();
			break;

		case 'toolStart':
			const toolBlock = document.createElement('div');
			toolBlock.className = 'tool-block';
			toolBlock.id = 'tool-' + msg.tool;
			toolBlock.innerHTML = '<div class="tool-name">🔧 ' + msg.tool + '</div><div class="tool-output">Running...</div>';
			if (currentAssistantEl) {
				currentAssistantEl.appendChild(toolBlock);
			} else {
				container.appendChild(toolBlock);
			}
			container.scrollTop = container.scrollHeight;
			break;

		case 'toolResult':
			const existingTool = document.getElementById('tool-' + msg.tool);
			if (existingTool) {
				existingTool.className = 'tool-block ' + (msg.success ? 'success' : 'failure');
				existingTool.querySelector('.tool-output').textContent = msg.output;
			}
			container.scrollTop = container.scrollHeight;
			break;

		case 'imageGenStart':
			const imgLoading = document.createElement('div');
			imgLoading.className = 'tool-block';
			imgLoading.id = 'imageGen';
			imgLoading.innerHTML = '<div class="tool-name">🎨 Generating image...</div><div class="tool-output">Please wait...</div>';
			container.appendChild(imgLoading);
			container.scrollTop = container.scrollHeight;
			break;

		case 'imageGenResult':
			const imgBlock = document.getElementById('imageGen');
			if (imgBlock && msg.images && msg.images.length > 0) {
				let imgHtml = '';
				for (const src of msg.images) {
					imgHtml += '<div class="image-result"><img src="' + src + '" alt="Generated image"><div class="caption">' + (msg.revisedPrompt || '') + '</div></div>';
				}
				imgBlock.outerHTML = imgHtml;
			} else if (imgBlock) {
				imgBlock.className = 'tool-block failure';
				imgBlock.querySelector('.tool-output').textContent = msg.error || 'Image generation failed';
			}
			break;

		case 'addUserMessage':
			document.getElementById('welcome')?.remove();
			addMessage('user', msg.content.substring(0, 100) + '...');
			break;
	}
});

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}
</script>
</body>
</html>`;
	}
}
