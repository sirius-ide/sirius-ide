/*---------------------------------------------------------------------------------------------
 *  Sirius — the panel's webview
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Drawn from the extension's state (panel/panelHost.ts), which is the source of truth: this
// page holds nothing a reload would lose. Model output is markdown rendered by `marked` and
// sanitised by DOMPurify before it touches the page; links go out through the extension.

import { marked } from '../../../../../src/vs/base/common/marked/marked.js';
import DOMPurify from '../../../../../src/vs/base/browser/dompurify/dompurify.js';
import type { Effort, Mode, ModelEntry, PanelState, ProviderView, ToHost, ToWebview, TurnView } from '../protocol';

declare function acquireVsCodeApi(): { postMessage(message: ToHost): void; setState(state: unknown): void; getState(): unknown };
const vscode = acquireVsCodeApi();
const send = (message: ToHost) => vscode.postMessage(message);

const MODE_LABELS: Record<Mode, string> = { ask: 'Ask', edit: 'Edit', agent: 'Agent' };
const EFFORT_LABELS: Record<Effort, string> = { off: 'Thinking off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

let state: PanelState | undefined;
/** Turns as streamed since the last state, by id: deltas land here between full states. */
const live = new Map<string, { text: string; thinking: string }>();
/** Thinking blocks the user opened or closed by hand, by turn id: their choice holds. */
const opened = new Map<string, boolean>();

// ─── Elements ────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; title?: string; attrs?: Record<string, string> } = {}, ...children: Node[]): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (props.class) { node.className = props.class; }
	if (props.text !== undefined) { node.textContent = props.text; }
	if (props.title) { node.title = props.title; node.setAttribute('aria-label', props.title); }
	for (const [name, value] of Object.entries(props.attrs ?? {})) { node.setAttribute(name, value); }
	node.append(...children);
	return node;
}

function iconButton(icon: string, title: string, onClick: () => void, extra = ''): HTMLButtonElement {
	const button = el('button', { class: `icon ${extra}`.trim(), title }, el('span', { class: `codicon codicon-${icon}` }));
	button.addEventListener('click', onClick);
	return button;
}

const app = document.getElementById('app')!;
const header = el('header', { class: 'bar' });
const main = el('main', { class: 'scroll' });
const footer = el('footer', { class: 'composer' });
app.append(header, main, footer);

const input = el('textarea', { attrs: { rows: '3', 'aria-label': 'Message' } });
const MOD = /Mac/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
const modeSelect = el('select', { title: 'Mode' });
const modelSelect = el('select', { title: 'Model' });
const effortSelect = el('select', { title: 'Thinking' });
const sendButton = iconButton('send', 'Send', () => submit(), 'primary');
const stopButton = iconButton('debug-stop', 'Stop', () => send({ type: 'stop' }), 'primary stop');
footer.append(input, el('div', { class: 'row' }, modeSelect, modelSelect, effortSelect, el('span', { class: 'spacer' }), sendButton, stopButton));

input.addEventListener('keydown', event => {
	if (event.key !== 'Enter' || event.isComposing) {
		return;
	}
	// The setting `sirius.panel.sendWith`: Enter, or Ctrl/Cmd+Enter with Enter for a new line.
	const sends = state?.sendWith === 'ctrlEnter' ? event.ctrlKey || event.metaKey : !event.shiftKey;
	if (sends) {
		event.preventDefault();
		submit();
	}
});
modeSelect.addEventListener('change', () => send({ type: 'setMode', mode: modeSelect.value as Mode }));
modelSelect.addEventListener('change', () => send({ type: 'setModel', key: modelSelect.value }));
effortSelect.addEventListener('change', () => send({ type: 'setEffort', effort: effortSelect.value as Effort }));

function submit(): void {
	const text = input.value;
	if (!text.trim() || state?.session.running) {
		return;
	}
	send({ type: 'send', text });
	input.value = '';
}

// ─── Markdown ────────────────────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: false });

/**
 * What a model may not put on the page, beyond what DOMPurify removes itself (scripts, event
 * handlers, `javascript:` links): anything that takes input or submits it — a form asking for a
 * key again is how a prompt-injected answer would phish it — stylesheets, which could restyle
 * the panel's own controls, and image maps, whose areas are links no handler here sees.
 */
const FORBIDDEN_TAGS = ['form', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'output', 'dialog', 'style', 'map', 'area'];

// A model's classes would let it draw the panel's own parts — an error box asking for a key, a
// message that looks like the user's. Only a code block's `language-*` stays.
DOMPurify.addHook('uponSanitizeAttribute', (_node, attribute) => {
	if (attribute.attrName === 'class') {
		const kept = attribute.attrValue.split(/\s+/).filter(name => /^language-[\w#+.-]+$/.test(name));
		if (kept.length) {
			attribute.attrValue = kept.join(' ');
		} else {
			attribute.keepAttr = false;
		}
	}
});

function markdown(text: string): HTMLElement {
	const body = el('div', { class: 'markdown' });
	body.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true }, FORBID_TAGS: FORBIDDEN_TAGS, FORBID_ATTR: ['style'] });
	// A task list's checkbox is the one input markdown makes: kept, and never editable.
	for (const field of Array.from(body.querySelectorAll('input'))) {
		if (field.type === 'checkbox') {
			field.disabled = true;
		} else {
			field.remove();
		}
	}
	// Code blocks: themed monospace with a Copy button (Insert and Apply come with editing).
	for (const pre of Array.from(body.querySelectorAll('pre'))) {
		const code = pre.textContent ?? '';
		const wrap = el('div', { class: 'code' }, el('div', { class: 'code-bar' }, iconButton('copy', 'Copy', () => send({ type: 'copy', text: code }))));
		pre.replaceWith(wrap);
		wrap.append(pre);
	}
	return body;
}

document.addEventListener('click', event => {
	const link = (event.target as HTMLElement).closest('a');
	if (link) {
		// VS Code's own webview script, listening on the window after this, would open the link
		// as well — without asking, in a trusted workspace — so the click stops here.
		event.preventDefault();
		event.stopPropagation();
		const href = link.getAttribute('href');
		if (href) { send({ type: 'openLink', href }); }
	}
});

// ─── Turns ───────────────────────────────────────────────────────────────────

function seconds(ms: number): string {
	const s = Math.max(1, Math.round(ms / 1000));
	return s === 1 ? '1 second' : `${s} seconds`;
}

function thinkingBlock(turn: TurnView, text: string, streaming: boolean, answering: boolean): HTMLElement {
	// Open while the model thinks and nothing of its answer has come; closed once the answer
	// starts — unless the user opened or closed it by hand.
	const open = opened.get(turn.id) ?? (streaming && !answering);
	const thinkingNow = streaming && !answering;
	const label = thinkingNow ? 'Thinking…' : turn.thinking?.ms !== undefined ? `Thought for ${seconds(turn.thinking.ms)}` : 'Thought';
	const head = el('button', { class: 'thinking-head', attrs: { 'aria-expanded': String(open) } },
		el('span', { class: `codicon codicon-${open ? 'chevron-down' : 'chevron-right'}` }),
		el('span', { class: 'label', text: label }));
	head.addEventListener('click', () => { opened.set(turn.id, !open); render(); });
	const box = el('div', { class: `thinking${open ? ' open' : ''}${thinkingNow ? ' streaming' : ''}` }, head);
	if (open) {
		box.append(el('div', { class: 'thinking-body', text }));
	}
	return box;
}

function usageLine(turn: TurnView, models: readonly ModelEntry[]): string {
	const parts: string[] = [];
	if (turn.usage) {
		parts.push(`${turn.usage.input.toLocaleString()} in`, `${turn.usage.output.toLocaleString()} out`);
		if (turn.usage.thinking) { parts.push(`${turn.usage.thinking.toLocaleString()} thinking`); }
	}
	if (turn.model) {
		parts.push(models.find(m => m.key === turn.model)?.label ?? turn.model.split('/').slice(1).join('/'));
	}
	return parts.join(' · ');
}

function turnElement(turn: TurnView, last: boolean): HTMLElement {
	if (turn.role === 'user') {
		return el('div', { class: 'turn user', attrs: { 'data-turn': turn.id } }, el('div', { class: 'bubble', text: turn.text }));
	}
	const stream = live.get(turn.id);
	const text = turn.streaming && stream ? stream.text : turn.text;
	const thought = turn.streaming && stream ? stream.thinking : turn.thinking?.text ?? '';
	const node = el('div', { class: `turn assistant${turn.streaming ? ' streaming' : ''}`, attrs: { 'data-turn': turn.id } });
	if (thought) {
		node.append(thinkingBlock(turn, thought, !!turn.streaming, text.length > 0));
	}
	if (text) {
		node.append(markdown(text));
	} else if (turn.streaming && !thought) {
		node.append(el('div', { class: 'waiting', text: 'Waiting for the model…' }));
	}
	if (turn.error) {
		node.append(el('div', { class: 'error', text: turn.error }));
	}
	const meta = el('div', { class: 'meta' });
	if (turn.stopped) { meta.append(el('span', { class: 'stopped', text: 'Stopped' })); }
	const line = usageLine(turn, state?.models ?? []);
	if (line && !turn.streaming) { meta.append(el('span', { text: line })); }
	if (last && !turn.streaming && !state?.session.running) {
		meta.append(iconButton('refresh', 'Retry', () => send({ type: 'retry' })));
	}
	if (meta.childNodes.length) { node.append(meta); }
	return node;
}

// ─── Views ───────────────────────────────────────────────────────────────────

function renderHeader(s: PanelState): void {
	header.replaceChildren(
		el('span', { class: 'title', text: s.view === 'setup' ? 'Models and Keys' : s.view === 'sessions' ? 'Conversations' : s.session.title }),
		el('span', { class: 'spacer' }),
		s.view === 'chat'
			? iconButton('history', 'Conversations', () => send({ type: 'setView', view: 'sessions' }))
			: iconButton('arrow-left', 'Back to the conversation', () => send({ type: 'setView', view: 'chat' })),
		iconButton('add', 'New conversation', () => send({ type: 'newSession' })),
		iconButton('gear', 'Models and keys', () => send({ type: 'setView', view: 'setup' }))
	);
}

function renderChat(s: PanelState): void {
	const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 40;
	const turns = s.session.turns;
	if (!turns.length) {
		main.replaceChildren(el('div', { class: 'empty' },
			el('div', { class: 'empty-title', text: 'Sirius' }),
			el('div', { text: s.models.length ? 'Ask anything about your code.' : 'Add a provider\'s key, or start a local server such as Ollama, to begin.' }),
			...(s.models.length ? [] : [el('button', { class: 'link', text: 'Models and keys' })])));
		main.querySelector('button.link')?.addEventListener('click', () => send({ type: 'setView', view: 'setup' }));
	} else {
		main.replaceChildren(el('div', { class: 'turns' }, ...turns.map((turn, i) => turnElement(turn, i === turns.length - 1))));
	}
	if (atBottom || s.session.running) { main.scrollTop = main.scrollHeight; }
}

function renderSessions(s: PanelState): void {
	if (!s.sessions.length) {
		main.replaceChildren(el('div', { class: 'empty', text: 'No conversations yet.' }));
		return;
	}
	main.replaceChildren(el('ul', { class: 'sessions' }, ...s.sessions.map(item => {
		const open = el('button', { class: `session${item.id === s.session.id ? ' current' : ''}` },
			el('span', { class: 'session-title', text: item.title }),
			el('span', { class: 'session-meta', text: `${new Date(item.updated).toLocaleString()} · ${item.turns} messages` }));
		open.addEventListener('click', () => send({ type: 'openSession', id: item.id }));
		return el('li', {}, open, iconButton('trash', `Delete "${item.title}"`, () => send({ type: 'deleteSession', id: item.id })));
	})));
}

function providerRow(p: ProviderView): HTMLElement {
	const status = p.problem ? p.problem : p.models ? `${p.models} model${p.models === 1 ? '' : 's'}` : p.kind === 'hosted' ? (p.hasKey ? 'No models' : 'No key') : p.kind === 'local' ? 'Not running' : 'No address';
	const row = el('div', { class: `provider${p.models ? ' ready' : ''}${p.problem ? ' problem' : ''}`, attrs: { 'data-provider': p.id } },
		el('div', { class: 'provider-head' }, el('span', { class: 'provider-name', text: p.label }), el('span', { class: 'provider-status', text: status })));
	if (p.takesKey) {
		const field = el('input', { attrs: { type: 'password', placeholder: p.hasKey ? 'Key saved — enter a new one to replace it' : p.kind === 'hosted' ? 'API key' : 'API key (if the server needs one)', 'aria-label': `${p.label} API key`, autocomplete: 'off' } });
		const save = el('button', { text: 'Save key' });
		save.addEventListener('click', () => { if (field.value.trim()) { send({ type: 'saveKey', provider: p.id, key: field.value }); field.value = ''; } });
		const line = el('div', { class: 'field' }, field, save);
		if (p.hasKey) {
			const remove = el('button', { class: 'secondary', text: 'Remove' });
			remove.addEventListener('click', () => send({ type: 'clearKey', provider: p.id }));
			line.append(remove);
		}
		row.append(line);
	}
	if (p.takesUrl) {
		const hint = p.kind === 'hosted' ? `Base URL — only for a gateway or proxy (${p.defaultUrl})` : p.defaultUrl || 'Server address';
		const url = el('input', { attrs: { type: 'text', placeholder: hint, 'aria-label': `${p.label} address` } });
		url.value = p.url ?? '';
		const save = el('button', { class: 'secondary', text: 'Save address' });
		save.addEventListener('click', () => send({ type: 'saveUrl', provider: p.id, url: url.value }));
		row.append(el('div', { class: 'field' }, url, save));
	}
	return row;
}

function renderSetup(s: PanelState): void {
	const refresh = el('button', { class: 'secondary', text: s.refreshing ? 'Checking…' : 'Check again' });
	refresh.addEventListener('click', () => send({ type: 'refreshModels' }));
	main.replaceChildren(el('div', { class: 'setup' },
		el('p', { class: 'note', text: 'Keys are kept in your system keyring and are sent only to their own vendor. Local servers are found at their usual address.' }),
		refresh,
		...s.providers.map(providerRow)));
}

function renderComposer(s: PanelState): void {
	footer.hidden = s.view !== 'chat';
	input.placeholder = s.sendWith === 'ctrlEnter' ? `Ask Sirius… (${MOD}+Enter to send)` : 'Ask Sirius… (Enter to send, Shift+Enter for a new line)';
	const options = <T extends string>(select: HTMLSelectElement, values: readonly T[], labels: (v: T) => string, current?: string) => {
		select.replaceChildren(...values.map(v => { const o = el('option', { text: labels(v) }); o.value = v; return o; }));
		if (current !== undefined) { select.value = current; }
	};
	options(modeSelect, ['ask', 'edit', 'agent'] as const, m => MODE_LABELS[m], s.mode);
	if (s.models.length) {
		options(modelSelect, s.models.map(m => m.key), key => s.models.find(m => m.key === key)?.label ?? key, s.model);
	} else {
		modelSelect.replaceChildren(el('option', { text: s.refreshing ? 'Looking for models…' : 'No models' }));
	}
	modelSelect.disabled = !s.models.length;
	const thinking = s.models.find(m => m.key === s.model)?.thinking ?? false;
	options(effortSelect, ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const, e => EFFORT_LABELS[e], s.effort);
	effortSelect.hidden = !thinking;
	sendButton.hidden = s.session.running;
	stopButton.hidden = !s.session.running;
}

function render(): void {
	if (!state) { return; }
	renderHeader(state);
	if (state.view === 'sessions') {
		renderSessions(state);
	} else if (state.view === 'setup') {
		renderSetup(state);
	} else {
		renderChat(state);
	}
	renderComposer(state);
}

// ─── From the extension ──────────────────────────────────────────────────────

let scheduled = false;
function schedule(): void {
	if (!scheduled) {
		scheduled = true;
		requestAnimationFrame(() => { scheduled = false; render(); });
	}
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
	const message = event.data;
	if (message.type === 'state') {
		state = message.state;
		vscode.setState({ sessionId: state.session.id });
		for (const turn of state.session.turns) {
			if (turn.streaming) {
				// A state mid-stream carries what was saved; keep what streamed since.
				const kept = live.get(turn.id);
				live.set(turn.id, { text: kept && kept.text.length > turn.text.length ? kept.text : turn.text, thinking: kept && kept.thinking.length > (turn.thinking?.text.length ?? 0) ? kept.thinking : turn.thinking?.text ?? '' });
			} else {
				live.delete(turn.id);
			}
		}
		render();
	} else if (message.type === 'delta') {
		const turn = live.get(message.turnId) ?? { text: '', thinking: '' };
		if (message.kind === 'text') { turn.text += message.text; } else { turn.thinking += message.text; }
		live.set(message.turnId, turn);
		schedule();
	} else if (message.type === 'turn' && state) {
		live.delete(message.turn.id);
		state = { ...state, session: { ...state.session, turns: state.session.turns.map(t => t.id === message.turn.id ? message.turn : t) } };
		render();
	}
});

send({ type: 'ready' });
