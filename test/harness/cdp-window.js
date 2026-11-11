/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A probe's view of its own window over the Chrome DevTools Protocol, on the port the runner
// opened (run.sh with SIRIUS_PROBE_ARGS=--remote-debugging-port=<n>, which chat-stub.sh sets, or
// vscode-run.sh; SIRIUS_PROBE_CDP_PORT=<n> for the probe):
//   connectWindow(appRoot)            — the workbench renderer; `evaluate` runs an expression there.
//   connectWebview(extensionId, kind) — an extension's webview ('webviewView' for a view, 'webviewPanel'
//                                       for a tab); `evaluate` runs in the webview's own page, with
//                                       `document` and `window` bound to it.

const CDP_PORT = Number(process.env.SIRIUS_PROBE_CDP_PORT || 0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The first target `pick` chooses, asking every 200 ms for up to `ms`. */
async function findTarget(pick, what, ms = 10000) {
	if (!CDP_PORT) {
		throw new Error('no SIRIUS_PROBE_CDP_PORT: run through test/harness/chat-stub.sh or vscode-run.sh');
	}
	if (typeof WebSocket !== 'function') {
		throw new Error('this extension host has no WebSocket');
	}
	for (const deadline = Date.now() + ms; Date.now() < deadline;) {
		try {
			const target = pick(await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json());
			if (target) {
				return target;
			}
		} catch { /* not up yet */ }
		await sleep(200);
	}
	throw new Error(`no ${what} on port ${CDP_PORT}`);
}

async function connect(target, wrap = expression => expression) {
	const ws = new WebSocket(target.webSocketDebuggerUrl);
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
			const answer = await call('Runtime.evaluate', { expression: wrap(expression), returnByValue: true, awaitPromise: true });
			if (answer.result?.exceptionDetails) {
				throw new Error(`page: ${answer.result.exceptionDetails.exception?.description ?? answer.result.exceptionDetails.text}`);
			}
			return answer.result?.result?.value;
		},
		/** Any CDP method, for what `evaluate` does not cover (a screenshot: `Page.captureScreenshot`). */
		async send(method, params = {}) {
			const answer = await call(method, params);
			if (answer.error) {
				throw new Error(`${method}: ${answer.error.message}`);
			}
			return answer.result;
		},
		close: () => ws.close()
	};
}

/** The window's renderer. `appRoot` is `vscode.env.appRoot`: the page must belong to this app. */
async function connectWindow(appRoot) {
	const appPath = appRoot ? appRoot.replace(/\/resources\/app$/, '') : undefined;
	// This app's window, by its install path in the page's URL: never another app's that
	// happens to hold the port.
	const page = await findTarget(targets => targets.find(t => t.type === 'page' && /workbench/.test(t.url) && (!appPath || decodeURIComponent(t.url).includes(appPath))), `workbench page of ${appPath ?? 'this app'}`);
	return connect(page);
}

/**
 * An extension's webview. VS Code hosts each webview in an iframe whose page loads the content
 * into a same-origin inner frame (`#active-frame`); expressions run in that inner page.
 */
async function connectWebview(extensionId, kind = 'webviewView', ms = 15000) {
	// A view's frame says `purpose=webviewView`; a tab's (a webview panel) says no purpose at all.
	const purpose = url => /[?&]purpose=([^&]*)/.exec(url)?.[1];
	const frame = await findTarget(targets => targets.find(t => t.type === 'iframe' && t.url.startsWith('vscode-webview://')
		&& t.url.includes(`extensionId=${extensionId}`) && (kind === 'webviewPanel' ? purpose(t.url) === undefined : purpose(t.url) === kind)), `${kind} of ${extensionId}`, ms);
	return connect(frame, expression => `(() => {
		const frame = document.getElementById('active-frame');
		const inner = frame && frame.contentDocument;
		if (!inner || !inner.getElementById('app')) { return { noContent: true }; }
		return (function (document, window) { return (${expression}); })(inner, frame.contentWindow);
	})()`);
}

module.exports = { connectWindow, connectWebview };
