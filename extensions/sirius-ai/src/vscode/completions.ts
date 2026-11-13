/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — Tab completion
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type FimBackend, llamaServerRoot, resolveFimBackendAt } from '../inline/fimClient';
import { type CompletionSettings, TabCompletionProvider, isEnabledFor } from '../inline/tabCompletionProvider';

export const ENABLE = 'sirius.completions.enable';
export const MODEL = 'sirius.completions.model';
const MAX_LINES = 'sirius.completions.maxLines';
/** Set while completions are on for every language, for the commands the Command Palette offers. */
const ON_CONTEXT = 'sirius.completions.on';
/** How long a server may take to say it is there. */
const PROBE_MS = 1500;
/** How long the status bar item trusts what it last found before it looks again. */
const FRESH_MS = 10_000;

/** Where the local servers are: the addresses and the llama.cpp key saved in the panel's Models and Keys. */
export interface LocalServers {
	ollama(): string;
	/** llama-server's address: the one saved, else its usual one. */
	llamacpp(): string;
	/** Whether llama-server's address was saved. */
	llamacppSaved(): boolean;
	llamaKey(): Promise<string>;
}

/**
 * Tab completion in VS Code: Sirius IDE's fill-in-the-middle provider, with its model on the
 * user's own Ollama or llama.cpp server at the addresses saved in Models and Keys — never at one a
 * workspace's settings name. Off until the user turns it on (`sirius.completions.enable`, per
 * language, `*` for the rest; the user's own settings only, so a workspace cannot turn it on, or
 * keep it on). A status bar item says whether it is on and which model fills in; its menu turns it
 * on or off, for every language or the open file's, and picks the model. Next-edit prediction stays
 * in Sirius IDE: VS Code shows an inline edit only to a proposed API.
 */
export class Completions implements vscode.Disposable {
	private readonly provider: TabCompletionProvider;
	private readonly status = vscode.window.createStatusBarItem('sirius.completions', vscode.StatusBarAlignment.Right, 100);
	private readonly disposables: vscode.Disposable[] = [];
	/** llama.cpp's key as last read from the keyring, for the FIM client, which reads it on every request. */
	private llamaKey = '';
	/** What the status bar item last found: the backend, and whether its server answered. */
	private found: { readonly id?: string; readonly ready: boolean; readonly at: number } | undefined;
	/** Counts status updates: an older one that finishes late does not draw over a newer one. */
	private shown = 0;
	/** Counts what makes a finding old — the model, the servers, a turn on: a look begun before is not kept. */
	private changes = 0;

	constructor(private readonly servers: LocalServers) {
		const settings: CompletionSettings = {
			enabledFor: languageId => isEnabledFor(vscode.workspace.getConfiguration().get(ENABLE), languageId),
			nextEdits: () => false,
			maxLines: () => vscode.workspace.getConfiguration().get<number>(MAX_LINES, 12),
			backend: () => this.backend()
		};
		this.provider = new TabCompletionProvider(settings);
		this.status.name = 'Sirius Tab Completion';
		this.status.command = 'sirius.completions.menu';
		this.disposables.push(
			this.status,
			vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, this.provider),
			vscode.commands.registerCommand('sirius.completions.turnOn', () => this.turn(true)),
			vscode.commands.registerCommand('sirius.completions.turnOff', () => this.turn(false)),
			vscode.commands.registerCommand('sirius.completions.menu', () => this.menu()),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(MODEL) || event.affectsConfiguration(MAX_LINES)) {
					this.provider.reset();
					this.outdated();
				} else if (event.affectsConfiguration(ENABLE)) {
					void this.update();
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(() => void this.update())
		);
		this.status.show();
		void this.update();
	}

	/** The addresses or the key changed in Models and Keys: look for the model again. */
	serversChanged(): void {
		this.provider.reset();
		this.outdated();
	}

	/** What the status bar item found is old now: it looks again (a look under way will not be kept). */
	private outdated(): void {
		this.found = undefined;
		this.changes++;
		void this.update();
	}

	dispose(): void {
		vscode.Disposable.from(...this.disposables).dispose();
	}

	/**
	 * The backend now. `auto` takes a code model on Ollama, else llama.cpp — only where its address
	 * or key was saved, or the usual address answers as llama-server: whatever else listens on port
	 * 8080 never gets the user's code. The keyring is read only when llama.cpp is in question, and one
	 * that does not answer leaves the last key read in place.
	 */
	private async backend(): Promise<FimBackend | undefined> {
		const model = vscode.workspace.getConfiguration().get<string>(MODEL, 'auto') || 'auto';
		const llamacpp = this.servers.llamacpp();
		const places = { ollamaEndpoint: this.servers.ollama().replace(/\/+$/, ''), llamaApiKey: () => this.llamaKey };
		let backend = await resolveFimBackendAt({ ...places, model, llamaBase: model === 'llamacpp' ? llamacpp : '' });
		if (!backend && model === 'auto') {
			// llama-server started with a key refuses /props without it: only then is the keyring read.
			const there = this.servers.llamacppSaved() ? 'yes' : await isLlamaServer(llamacpp);
			if (there === 'yes' || (there === 'keyed' && await this.readLlamaKey())) {
				backend = await resolveFimBackendAt({ ...places, model: 'llamacpp', llamaBase: llamacpp });
			}
		}
		if (backend?.id === 'llamacpp') {
			await this.readLlamaKey();
		}
		return backend;
	}

	private async readLlamaKey(): Promise<string> {
		const key = await this.servers.llamaKey().catch(() => undefined);
		if (key !== undefined) {
			this.llamaKey = key;
		}
		return this.llamaKey;
	}

	private enable(): Record<string, boolean> {
		const value = vscode.workspace.getConfiguration().inspect<Record<string, boolean>>(ENABLE)?.globalValue;
		return typeof value === 'object' && value !== null ? { ...value } : {};
	}

	/** On or off for every language, or for one: languages the user set on their own keep their own value. */
	private async turn(on: boolean, languageId?: string): Promise<void> {
		const enable = this.enable();
		enable[languageId ?? '*'] = on;
		await vscode.workspace.getConfiguration().update(ENABLE, enable, vscode.ConfigurationTarget.Global);
		if (on && !languageId) {
			const backend = await this.backend();
			if (!backend || !await this.answers(backend)) {
				const setup = 'Open Models and Keys';
				const choice = await vscode.window.showWarningMessage('Tab completion is on, but no local code model answers yet. Start Ollama with a coder model, or llama-server, and Sirius picks it up — or give their address in Models and Keys.', setup);
				if (choice === setup) {
					await vscode.commands.executeCommand('sirius.panel.setup');
				}
			}
		}
	}

	/** The status bar item: off for the open file, or on and with which model — looked for again when what it found is old. */
	private async update(): Promise<void> {
		const which = ++this.shown;
		const enable = vscode.workspace.getConfiguration().get(ENABLE);
		const languageId = vscode.window.activeTextEditor?.document.languageId;
		const everywhere = isEnabledFor(enable, '*');
		const here = languageId ? isEnabledFor(enable, languageId) : everywhere;
		void vscode.commands.executeCommand('setContext', ON_CONTEXT, everywhere);
		if (!here) {
			this.status.text = '$(circle-slash) Tab';
			this.status.tooltip = languageId && everywhere ? `Sirius Tab completion is off for ${languageId}. Click to change.` : 'Sirius Tab completion is off. Click to turn it on.';
			return;
		}
		if (!this.found || Date.now() - this.found.at > FRESH_MS) {
			// Nothing found yet, or the item still says off: it says it is looking.
			if (!this.found || this.status.text === '$(circle-slash) Tab') {
				this.status.text = '$(loading~spin) Tab';
				this.status.tooltip = 'Sirius Tab completion is on: looking for a local code model…';
			}
			const changes = this.changes;
			const backend = await this.backend().catch(() => undefined);
			const ready = backend ? await this.answers(backend) : false;
			if (changes === this.changes) {
				this.found = { id: backend?.id, ready, at: Date.now() };
			}
			if (which !== this.shown || !this.found) {
				return;
			}
		}
		this.status.text = this.found.ready ? '$(sparkle) Tab' : '$(warning) Tab';
		this.status.tooltip = this.found.ready
			? `Sirius Tab completion is on, with ${this.found.id}. Click to change.`
			: 'Sirius Tab completion is on, but no local code model answers: start Ollama with a coder model, or llama-server, or give their address in Models and Keys.';
	}

	/** Whether the backend's server is there: Ollama lists the model; llama-server answers its health check. */
	private async answers(backend: FimBackend): Promise<boolean> {
		if (backend.id.startsWith('ollama/')) {
			return (await ollamaModels(this.servers.ollama())).includes(backend.id.slice('ollama/'.length));
		}
		try {
			const response = await fetch(`${llamaServerRoot(this.servers.llamacpp())}/health`, { signal: AbortSignal.timeout(PROBE_MS), headers: this.llamaKey ? { Authorization: `Bearer ${this.llamaKey}` } : {} });
			return response.ok;
		} catch {
			return false;
		}
	}

	private async menu(): Promise<void> {
		const config = vscode.workspace.getConfiguration();
		const languageId = vscode.window.activeTextEditor?.document.languageId;
		const everywhere = isEnabledFor(config.get(ENABLE), '*');
		const here = languageId ? isEnabledFor(config.get(ENABLE), languageId) : everywhere;
		const model = config.get<string>(MODEL, 'auto') || 'auto';
		type Item = vscode.QuickPickItem & { run(): Thenable<unknown> };
		const items: Item[] = [
			{ label: everywhere ? 'Turn Off Tab Completion' : 'Turn On Tab Completion', run: () => this.turn(!everywhere) },
			...(languageId && here === everywhere ? [{ label: `${here ? 'Turn Off' : 'Turn On'} for ${languageId}`, run: () => this.turn(!here, languageId) }] : []),
			...(languageId && here !== everywhere ? [{ label: `${everywhere ? 'Turn On' : 'Turn Off'} for ${languageId}, as for the Others`, description: `${languageId} is ${here ? 'on' : 'off'} on its own now`, run: () => this.forget(languageId) }] : []),
			{ label: 'Model…', description: model === 'auto' ? 'Auto' : model, run: () => this.chooseModel() },
			{ label: 'Models and Keys…', description: 'local server addresses', run: () => vscode.commands.executeCommand('sirius.panel.setup') }
		];
		const picked = await vscode.window.showQuickPick(items, { title: 'Sirius Tab Completion' });
		await picked?.run();
	}

	private async forget(languageId: string): Promise<void> {
		const enable = this.enable();
		delete enable[languageId];
		await vscode.workspace.getConfiguration().update(ENABLE, enable, vscode.ConfigurationTarget.Global);
	}

	private async chooseModel(): Promise<void> {
		const ollama = await ollamaModels(this.servers.ollama());
		type Item = vscode.QuickPickItem & { value: string };
		const items: Item[] = [
			{ label: 'Auto', description: 'a code model on Ollama, else llama.cpp', value: 'auto' },
			...ollama.map(name => ({ label: name, description: 'Ollama', value: `ollama/${name}` })),
			{ label: 'llama.cpp', description: this.servers.llamacpp(), value: 'llamacpp' }
		];
		const current = vscode.workspace.getConfiguration().get<string>(MODEL, 'auto') || 'auto';
		for (const item of items) {
			if (item.value === current) {
				item.detail = 'chosen now';
			}
		}
		const picked = await vscode.window.showQuickPick(items, { title: 'Tab Completion Model', placeHolder: ollama.length ? undefined : 'No Ollama models found — is Ollama running at its address in Models and Keys?' });
		if (picked) {
			await vscode.workspace.getConfiguration().update(MODEL, picked.value === 'auto' ? undefined : picked.value, vscode.ConfigurationTarget.Global);
		}
	}
}

/** The models of the Ollama server at `endpoint`, or none when it does not answer. */
async function ollamaModels(endpoint: string): Promise<string[]> {
	try {
		const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(PROBE_MS) });
		const body = response.ok ? await response.json() as { models?: { name?: unknown }[] } : {};
		return (body.models ?? []).map(m => m.name).filter((name): name is string => typeof name === 'string');
	} catch {
		return [];
	}
}

/**
 * Whether llama-server answers at `base`: its /props describe its generation settings, which no
 * other server's do — `keyed` when something there wants a key for them (llama-server's --api-key).
 */
async function isLlamaServer(base: string): Promise<'yes' | 'keyed' | 'no'> {
	try {
		const response = await fetch(`${llamaServerRoot(base)}/props`, { signal: AbortSignal.timeout(PROBE_MS) });
		if (response.status === 401) {
			return 'keyed';
		}
		const body = response.ok ? await response.json() as { default_generation_settings?: unknown } : {};
		return typeof body.default_generation_settings === 'object' && body.default_generation_settings !== null ? 'yes' : 'no';
	} catch {
		return 'no';
	}
}
