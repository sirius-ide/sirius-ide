/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A probe's view of its own window: the workbench renderer over the Chrome DevTools Protocol, on
// the port run.sh opened (SIRIUS_PROBE_ARGS=--remote-debugging-port=<n>, which chat-stub.sh sets,
// with SIRIUS_PROBE_CDP_PORT=<n> for the probe). `evaluate` runs an expression in the page and
// returns its value.

const CDP_PORT = Number(process.env.SIRIUS_PROBE_CDP_PORT || 0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The window's renderer over the Chrome DevTools Protocol. */
/** `appRoot` is `vscode.env.appRoot`: the page must belong to this app. */
async function connectWindow(appRoot) {
	const appPath = appRoot ? appRoot.replace(/\/resources\/app$/, '') : undefined;
	if (!CDP_PORT) {
		throw new Error('no SIRIUS_PROBE_CDP_PORT: run through test/harness/chat-stub.sh');
	}
	if (typeof WebSocket !== 'function') {
		throw new Error('this extension host has no WebSocket');
	}
	let page;
	for (let i = 0; i < 50 && !page; i++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
			// This app's window, by its install path in the page's URL: never another app's that
			// happens to hold the port.
			page = targets.find(t => t.type === 'page' && /workbench/.test(t.url) && (!appPath || decodeURIComponent(t.url).includes(appPath)));
		} catch { /* not up yet */ }
		if (!page) { await sleep(200); }
	}
	if (!page) {
		throw new Error(`no workbench page of ${appPath ?? 'this app'} on port ${CDP_PORT}`);
	}
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP connection failed')); });
	let id = 0;
	const pending = new Map();
	ws.onmessage = event => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
	};
	const call = (method, params) => new Promise(resolve => {
		const n = ++id;
		pending.set(n, resolve);
		ws.send(JSON.stringify({ id: n, method, params }));
	});
	return {
		async evaluate(expression) {
			const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
			if (answer.result?.exceptionDetails) {
				throw new Error(`page: ${answer.result.exceptionDetails.text}`);
			}
			return answer.result?.result?.value;
		},
		close: () => ws.close()
	};
}

module.exports = { connectWindow };
