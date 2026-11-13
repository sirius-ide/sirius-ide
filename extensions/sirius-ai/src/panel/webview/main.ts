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
import { IMAGE_MIME_TYPES, MAX_FILES, MAX_PASTED, MAX_PASTED_BASE64, type EditorView, type Edits, type Effort, type Mode, type ModelEntry, type PanelState, type PastedImage, type ProviderView, type ToHost, type ToolView, type ToWebview, type TurnView } from '../protocol';

declare function acquireVsCodeApi(): { postMessage(message: ToHost): void; setState(state: unknown): void; getState(): unknown };
const vscode = acquireVsCodeApi();
const send = (message: ToHost) => vscode.postMessage(message);

const MODE_LABELS: Record<Mode, string> = { ask: 'Ask', edit: 'Edit', agent: 'Agent' };
const EFFORT_LABELS: Record<Effort, string> = { off: 'Thinking off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const EDITS_LABELS: Record<Edits, string> = { ask: 'Ask before edits', auto: 'Auto-accept edits' };

let state: PanelState | undefined;
/** Turns as streamed since the last state, by id: deltas land here between full states. */
const live = new Map<string, { text: string; thinking: string }>();
/** Thinking blocks the user opened or closed by hand, by turn id: their choice holds. */
const opened = new Map<string, boolean>();
/** Tool cards the user opened, by `<turn>:<call>`. */
const openedTools = new Map<string, boolean>();
/**
 * When each waiting card was first drawn, by card. Its buttons wait this long before they take a
 * click: a card drawn where the last one was would otherwise take a second click meant for that.
 */
const waitingSince = new Map<string, number>();
const ARM_MS = 500;

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
const editsSelect = el('select', { title: 'Edits' });
const sendButton = iconButton('send', 'Send', () => submit(), 'primary');
const stopButton = iconButton('debug-stop', 'Stop', () => send({ type: 'stop' }), 'primary stop');
const attachButton = iconButton('attach', 'Attach files', () => send({ type: 'attach' }));
/** What the next question carries: the open file and selection (switched off here), mentions, files, images. */
const chips = el('div', { class: 'chips' });
const suggest = el('ul', { class: 'suggest', attrs: { role: 'listbox', 'aria-label': 'Files' } });
suggest.hidden = true;
/** A word about what the composer did not take — a picture too large, one too many — or gave back. */
const note = el('div', { class: 'composer-note', attrs: { role: 'status' } });
note.hidden = true;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string): void {
	note.textContent = text;
	note.hidden = false;
	clearTimeout(noteTimer);
	noteTimer = setTimeout(() => { note.hidden = true; }, 8000);
}
footer.append(note, chips, suggest, input, el('div', { class: 'row' }, modeSelect, modelSelect, effortSelect, editsSelect, el('span', { class: 'spacer' }), attachButton, sendButton, stopButton));

// ─── What a question carries ─────────────────────────────────────────────────

let editor: EditorView | undefined;
/** The chips the user switched off stay off until switched on again. */
let useFile = true;
let useSelection = true;
let mentions: string[] = [];
let picked: { id: string; label: string }[] = [];
let pasted: (PastedImage & { size: number })[] = [];

function chip(text: string, title: string, on: boolean, toggle: (() => void) | undefined, remove: (() => void) | undefined): HTMLElement {
	const node = el('span', { class: `chip${on ? '' : ' off'}`, attrs: { 'data-chip': text } });
	const label = el('button', { class: 'chip-label', text, title });
	label.setAttribute('aria-pressed', String(on));
	if (toggle) {
		label.addEventListener('click', toggle);
	} else {
		label.disabled = true;
	}
	node.append(label);
	if (remove) {
		node.append(iconButton('close', `Remove ${text}`, remove, 'chip-remove'));
	}
	return node;
}

function renderChips(): void {
	const nodes: HTMLElement[] = [];
	if (editor) {
		nodes.push(chip(editor.path, useFile ? 'The open file goes with your message: click to leave it out' : 'Left out: click to send the open file with your message', useFile, () => { useFile = !useFile; renderChips(); }, undefined));
		if (editor.selection) {
			const lines = editor.selection.start === editor.selection.end ? `line ${editor.selection.start}` : `lines ${editor.selection.start}-${editor.selection.end}`;
			nodes.push(chip(lines, useSelection ? 'The selection goes with your message: click to leave it out' : 'Left out: click to send the selection with your message', useSelection, () => { useSelection = !useSelection; renderChips(); }, undefined));
		}
	}
	for (const path of mentions) {
		// Removing the chip takes the @-mention out of the message too.
		nodes.push(chip(`@${path}`, path, true, undefined, () => {
			mentions = mentions.filter(m => m !== path);
			input.value = input.value.split(`@${path}`).join('').replace(/ {2,}/g, ' ');
			renderChips();
		}));
	}
	for (const file of picked) {
		nodes.push(chip(file.label, file.label, true, undefined, () => { picked = picked.filter(p => p !== file); renderChips(); }));
	}
	pasted.forEach((image, i) => {
		nodes.push(chip(`image ${i + 1} (${Math.max(1, Math.round(image.size / 1024))} KB)`, image.mimeType, true, undefined, () => { pasted = pasted.filter(p => p !== image); renderChips(); }));
	});
	chips.replaceChildren(...nodes);
	chips.hidden = nodes.length === 0;
}

// @-mentions: what follows an @ before the cursor asks the extension for files; one picked joins the question.
let suggestions: string[] = [];
let active = 0;
let searchId = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function mentionAtCursor(): { start: number; query: string } | undefined {
	const before = input.value.slice(0, input.selectionStart ?? input.value.length);
	const match = /(^|\s)@([^\s@]*)$/.exec(before);
	return match ? { start: before.length - match[2].length - 1, query: match[2] } : undefined;
}

function closeSuggest(): void {
	suggestions = [];
	suggest.hidden = true;
	suggest.replaceChildren();
}

function renderSuggest(): void {
	suggest.replaceChildren(...suggestions.map((path, i) => {
		const item = el('li', { class: `suggestion${i === active ? ' active' : ''}`, text: path, attrs: { role: 'option', 'aria-selected': String(i === active) } });
		item.addEventListener('mousedown', event => { event.preventDefault(); pick(path); });
		return item;
	}));
	suggest.hidden = suggestions.length === 0;
}

function pick(path: string): void {
	const at = mentionAtCursor();
	if (at) {
		const end = input.selectionStart ?? input.value.length;
		input.value = `${input.value.slice(0, at.start)}@${path} ${input.value.slice(end)}`;
		const caret = at.start + path.length + 2;
		input.setSelectionRange(caret, caret);
	}
	if (!mentions.includes(path) && mentions.length + picked.length < MAX_FILES) {
		mentions.push(path);
	}
	closeSuggest();
	renderChips();
	input.focus();
}

input.addEventListener('input', () => {
	const at = mentionAtCursor();
	clearTimeout(searchTimer);
	// A list from the query before is not offered for this one: Enter would take a file not asked for.
	closeSuggest();
	if (!at) {
		return;
	}
	searchTimer = setTimeout(() => send({ type: 'searchFiles', requestId: ++searchId, query: at.query }), 80);
});
input.addEventListener('blur', () => setTimeout(closeSuggest, 150));

// A pasted image goes with the question, for a model that can see; one too large is left out.
input.addEventListener('paste', event => {
	const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file' && IMAGE_MIME_TYPES.includes(item.type)).map(item => item.getAsFile()).filter((file): file is File => !!file);
	if (!files.length) {
		return;
	}
	event.preventDefault();
	for (const file of files) {
		if (pasted.length >= MAX_PASTED) {
			say(`Not added: a message takes at most ${MAX_PASTED} pictures.`);
			break;
		}
		const reader = new FileReader();
		reader.addEventListener('load', () => {
			const base64 = String(reader.result).replace(/^data:[^,]*,/, '');
			if (base64.length > MAX_PASTED_BASE64) {
				say('Not added: the picture is larger than 3.75 MB.');
			} else if (pasted.length >= MAX_PASTED) {
				say(`Not added: a message takes at most ${MAX_PASTED} pictures.`);
			} else {
				pasted.push({ mimeType: file.type, base64, size: file.size });
				renderChips();
			}
		});
		reader.readAsDataURL(file);
	}
});

input.addEventListener('keydown', event => {
	// While files are suggested, the arrows choose, Enter or Tab takes one, Escape closes the list.
	if (!suggest.hidden && suggestions.length && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length;
			renderSuggest();
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			pick(suggestions[active]);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeSuggest();
			return;
		}
	}
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
editsSelect.addEventListener('change', () => send({ type: 'setEdits', edits: editsSelect.value as Edits }));

/** Messages sent and not yet taken, as the composer held them, by the name each went with: put back if the extension did not take one. */
const sentMessages = new Map<string, { text: string; mentions: string[]; picked: typeof picked; pasted: typeof pasted }>();
let sentCount = 0;

function submit(): void {
	const text = input.value;
	if (!text.trim() || state?.session.running) {
		return;
	}
	// A mention whose @path was deleted from the message is not sent.
	const id = `m${++sentCount}`;
	send({ type: 'send', id, text, file: useFile, selection: useSelection, mentions: mentions.filter(path => text.includes(`@${path}`)), attachments: picked.map(file => file.id), images: pasted.map(image => ({ mimeType: image.mimeType, base64: image.base64 })) });
	sentMessages.set(id, { text, mentions, picked, pasted });
	// Only the last few could still come back.
	for (const old of [...sentMessages.keys()].slice(0, -8)) {
		sentMessages.delete(old);
	}
	note.hidden = true;
	input.value = '';
	mentions = [];
	picked = [];
	pasted = [];
	closeSuggest();
	renderChips();
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
	// Code blocks: themed monospace; Insert at the cursor, Apply to the open file (reviewed in the diff editor), Copy.
	for (const pre of Array.from(body.querySelectorAll('pre'))) {
		const code = pre.textContent ?? '';
		const wrap = el('div', { class: 'code' }, el('div', { class: 'code-bar' },
			iconButton('insert', 'Insert at the cursor', () => send({ type: 'insertCode', code })),
			iconButton('diff-single', 'Apply to the open file', () => send({ type: 'applyCode', code })),
			iconButton('copy', 'Copy', () => send({ type: 'copy', text: code }))));
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

const TOOL_ICONS: Record<ToolView['status'], string> = { running: 'loading codicon-modifier-spin', waiting: 'question', done: 'check', failed: 'error', denied: 'circle-slash', stopped: 'debug-stop' };
const TOOL_STATUS: Record<ToolView['status'], string> = { running: 'Running…', waiting: 'Waiting for you', done: '', failed: 'Failed', denied: 'Declined', stopped: 'Stopped' };
const APPROVE = [['once', 'Allow once'], ['session', 'Allow for this conversation'], ['deny', 'Deny']] as const;

/** A tool call: what it does and how it went; its output on a click; the user's choice while it waits. */
function toolCard(turn: TurnView, tool: ToolView): HTMLElement {
	const key = `${turn.id}:${tool.id}`;
	const open = openedTools.get(key) ?? false;
	const head = el('button', { class: 'tool-head', attrs: { 'aria-expanded': String(open) } },
		el('span', { class: `codicon codicon-${TOOL_ICONS[tool.status]}` }),
		el('span', { class: 'tool-label', text: tool.label }),
		el('span', { class: 'tool-status', text: TOOL_STATUS[tool.status] }));
	head.addEventListener('click', () => { openedTools.set(key, !open); render(); });
	const card = el('div', { class: `tool ${tool.status}${open ? ' open' : ''}`, attrs: { 'data-call': tool.id } }, head);
	if (tool.status === 'waiting') {
		// What it will run with, before it is allowed: a tool's name alone says too little.
		const row = el('div', { class: 'tool-ask' }, el('span', { text: `Run ${tool.name}?` }));
		if (tool.input) {
			row.append(el('pre', { class: 'tool-input', text: tool.input }));
		}
		const ready = armed(tool.id);
		card.dataset.waitedMs = String(Math.round(performance.now() - waitingSince.get(tool.id)!));
		for (const [choice, label] of APPROVE) {
			const button = el('button', { class: choice === 'deny' ? 'secondary' : 'allow', text: label });
			button.disabled = !ready;
			button.addEventListener('click', () => send({ type: 'approve', turnId: turn.id, callId: tool.id, choice }));
			row.append(button);
		}
		card.append(row);
	}
	if (open && tool.input && tool.status !== 'waiting') {
		card.append(el('pre', { class: 'tool-input', text: tool.input }));
	}
	if (open && tool.output) {
		card.append(el('pre', { class: 'tool-output', text: tool.output }));
	}
	return card;
}

/** How long a waiting card's buttons have waited, by `key`; they take a click once ARM_MS is over. */
function armed(key: string): boolean {
	const since = waitingSince.get(key) ?? performance.now();
	waitingSince.set(key, since);
	const waited = performance.now() - since;
	if (waited < ARM_MS) {
		setTimeout(schedule, ARM_MS - waited + 20);
	}
	return waited >= ARM_MS;
}

const EDIT_ICONS: Record<ToolView['status'], string> = { ...TOOL_ICONS, waiting: 'diff' };
const EDIT_STATUS: Record<ToolView['status'], string> = { running: 'Applying…', waiting: 'Waiting for you', done: 'Accepted', failed: 'Failed', denied: 'Rejected', stopped: 'Stopped' };

/** A change to a file: what it touches and by how much; Accept and Reject while it waits; its diff on a click. */
function editCard(turn: TurnView, tool: ToolView): HTMLElement {
	const edit = tool.edit!;
	const key = `${turn.id}:${tool.id}`;
	const open = openedTools.get(key) ?? false;
	const head = el('button', { class: 'tool-head', attrs: { 'aria-expanded': String(open) } },
		el('span', { class: `codicon codicon-${EDIT_ICONS[tool.status]}` }),
		el('span', { class: 'tool-label', text: tool.label }),
		el('span', { class: 'edit-counts' }, el('span', { class: 'added', text: `+${edit.added}` }), el('span', { class: 'removed', text: `−${edit.removed}` })),
		el('span', { class: 'tool-status', text: tool.status === 'done' && edit.auto ? 'Applied' : EDIT_STATUS[tool.status] }));
	head.addEventListener('click', () => { openedTools.set(key, !open); render(); });
	const card = el('div', { class: `tool edit ${tool.status}${open ? ' open' : ''}`, attrs: { 'data-call': tool.id, 'data-batch': edit.batch } }, head);
	const row = el('div', { class: 'tool-ask' });
	if (tool.status === 'waiting' && edit.guarded) {
		row.append(el('span', { class: 'edit-why', text: 'This file can run code or change how the workspace builds, so it is accepted only here: never by Accept all or Auto-accept edits.' }));
	}
	if (tool.status === 'waiting') {
		const ready = armed(tool.id);
		card.dataset.waitedMs = String(Math.round(performance.now() - waitingSince.get(tool.id)!));
		for (const [choice, label] of [['accept', 'Accept'], ['reject', 'Reject']] as const) {
			const button = el('button', { class: choice === 'reject' ? 'secondary' : 'allow', text: label });
			button.disabled = !ready;
			button.addEventListener('click', () => send({ type: 'decide', callId: tool.id, choice }));
			row.append(button);
		}
	}
	// A change that never reached the file has nothing to show beside it.
	if (edit.diff && (tool.status === 'waiting' || tool.status === 'done')) {
		const diff = el('button', { class: 'secondary', text: 'Show diff' });
		diff.addEventListener('click', () => send({ type: 'showDiff', callId: tool.id }));
		row.append(diff);
	}
	if (row.childNodes.length) {
		card.append(row);
	}
	if (open && tool.output) {
		card.append(el('pre', { class: 'tool-output', text: tool.output }));
	}
	return card;
}

/** Under a round's last waiting change, when several wait: decides them all — but accepts no file that can run code. */
function batchBar(batch: string, waiting: readonly ToolView[]): HTMLElement {
	const ready = armed(`batch:${batch}`);
	const guarded = waiting.filter(tool => tool.edit?.guarded).length;
	const all = guarded === waiting.length;
	const left = all ? ' — each to accept on its own card' : guarded ? ` — Accept all leaves ${guarded === 1 ? 'one file' : `${guarded} files`} for ${guarded === 1 ? 'its' : 'their'} own card` : '';
	const bar = el('div', { class: 'edit-batch', attrs: { 'data-batch': batch } }, el('span', { text: `${waiting.length} changes waiting${left}` }));
	// Accept all would take none of them when each can run code: only Reject all is offered.
	for (const [choice, label] of all ? [['reject', 'Reject all']] as const : [['accept', 'Accept all'], ['reject', 'Reject all']] as const) {
		const button = el('button', { class: choice === 'reject' ? 'secondary' : 'allow', text: label });
		button.disabled = !ready;
		button.addEventListener('click', () => send({ type: 'decideAll', batch, choice }));
		bar.append(button);
	}
	return bar;
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
		const node = el('div', { class: 'turn user', attrs: { 'data-turn': turn.id } }, el('div', { class: 'bubble', text: turn.text }));
		if (turn.attached?.length) {
			node.append(el('div', { class: 'attached' }, ...turn.attached.map(label => el('span', { class: 'chip', text: label }))));
		}
		return node;
	}
	const stream = live.get(turn.id);
	const text = turn.streaming && stream ? stream.text : turn.text;
	const thought = turn.streaming && stream ? stream.thinking : turn.thinking?.text ?? '';
	const node = el('div', { class: `turn assistant${turn.streaming ? ' streaming' : ''}`, attrs: { 'data-turn': turn.id } });
	if (thought) {
		node.append(thinkingBlock(turn, thought, !!turn.streaming, text.length > 0));
	}
	if (turn.notice) {
		node.append(el('div', { class: 'notice', text: turn.notice }));
	}
	// Each round's text, then the tools it ran: a card sits where in the answer its tool ran. A
	// round's changes still waiting, when there are several, end with Accept all and Reject all.
	let from = 0;
	const cards = [...(turn.tools ?? [])].sort((a, b) => a.at - b.at);
	const waiting = (batch: string) => cards.filter(tool => tool.edit?.batch === batch && tool.status === 'waiting');
	for (const tool of cards) {
		const at = Math.min(Math.max(tool.at, from), text.length);
		if (text.slice(from, at).trim()) {
			node.append(markdown(text.slice(from, at)));
		}
		node.append(tool.edit ? editCard(turn, tool) : toolCard(turn, tool));
		const batch = tool.edit && tool.status === 'waiting' ? waiting(tool.edit.batch) : [];
		if (batch.length > 1 && batch[batch.length - 1] === tool) {
			node.append(batchBar(tool.edit!.batch, batch));
		}
		from = at;
	}
	if (text.slice(from).trim()) {
		node.append(markdown(text.slice(from)));
	} else if (turn.streaming && !thought && !turn.tools?.length) {
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
		// A model its vendor deprecated says so; the description is the option's tooltip.
		options(modelSelect, s.models.map(m => m.key), key => { const m = s.models.find(x => x.key === key); return m ? `${m.label}${m.detail === 'Deprecated by its vendor' ? ' (deprecated)' : ''}` : key; }, s.model);
		for (const option of modelSelect.options) {
			const detail = s.models.find(m => m.key === option.value)?.detail;
			if (detail) { option.title = detail; }
		}
	} else {
		modelSelect.replaceChildren(el('option', { text: s.refreshing ? 'Looking for models…' : 'No models' }));
	}
	modelSelect.disabled = !s.models.length;
	const thinking = s.models.find(m => m.key === s.model)?.thinking ?? false;
	options(effortSelect, ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const, e => EFFORT_LABELS[e], s.effort);
	effortSelect.hidden = !thinking;
	options(editsSelect, ['ask', 'auto'] as const, e => EDITS_LABELS[e], s.edits);
	editsSelect.hidden = s.mode === 'ask';
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
	if (message.type === 'editor') {
		editor = message.editor;
		renderChips();
		return;
	}
	if (message.type === 'files') {
		if (message.requestId === searchId && mentionAtCursor()) {
			suggestions = [...message.files];
			active = 0;
			renderSuggest();
		}
		return;
	}
	if (message.type === 'unsent') {
		// Not taken: back in the box, before whatever was typed since, with its files and pictures beside those added since.
		const back = sentMessages.get(message.id);
		sentMessages.delete(message.id);
		if (back) {
			input.value = input.value.trim() ? `${back.text}\n\n${input.value}` : back.text;
			mentions = [...new Set([...back.mentions, ...mentions])];
			picked = [...back.picked, ...picked.filter(file => !back.picked.some(p => p.id === file.id))].slice(0, MAX_FILES);
			pasted = [...back.pasted, ...pasted.filter(image => !back.pasted.includes(image))].slice(0, MAX_PASTED);
			renderChips();
			say(message.reason === 'busy' ? 'Not sent yet — the message before it is still on its way. Send it again in a moment.' : 'Not sent — it could not be put together. It is back in the box.');
		}
		return;
	}
	if (message.type === 'attached') {
		for (const file of message.files) {
			if (mentions.length + picked.length < MAX_FILES) {
				picked.push(file);
			}
		}
		renderChips();
		return;
	}
	if (message.type === 'state') {
		const first = !state;
		state = message.state;
		if (first || message.state.editor?.path !== editor?.path || message.state.editor?.selection?.start !== editor?.selection?.start || message.state.editor?.selection?.end !== editor?.selection?.end) {
			editor = message.state.editor;
			renderChips();
		}
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
