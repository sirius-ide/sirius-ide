/*---------------------------------------------------------------------------------------------
 *  Sirius IDE — Connection checks
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * What a provider's connection check found. The Language Models editor shows a failed
 * provider as a red row with this text, so it says which of the usual causes it was — a
 * rejected key and a server that is not running otherwise look the same: no models.
 */
export type ConnectionCheck = { readonly ok: true } | { readonly ok: false; readonly problem: string };

const CHECK_TIMEOUT_MS = 8000;

/** How a check may differ from the plain GET. */
export interface CheckOptions {
	/** A 404 passes — a gateway that proxies only the chat endpoint has no model listing. */
	readonly notFoundIsFine?: boolean;
	/** Refuse to follow a redirect: a key in a custom header would follow it to another host. */
	readonly noRedirect?: boolean;
}

/** One cheap authenticated GET — a model listing — read as a verdict. */
export async function checkEndpoint(url: string, headers: Record<string, string>, provider: string, options: CheckOptions = {}): Promise<ConnectionCheck> {
	const origin = originOf(url);
	try {
		const response = await fetch(url, { headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), ...(options.noRedirect ? { redirect: 'error' as const } : {}) });
		if (response.ok || (response.status === 404 && options.notFoundIsFine)) {
			return { ok: true };
		}
		const body = response.status === 400 ? await response.text().catch(() => '') : '';
		if (isRejectedKey(response.status, body)) {
			return { ok: false, problem: `${provider} rejected the API key (HTTP ${response.status}).` };
		}
		return { ok: false, problem: `${provider} answered HTTP ${response.status} at ${origin}.` };
	} catch {
		return { ok: false, problem: `${provider} did not answer at ${origin}.` };
	}
}

/** The URL's origin for a message — or the URL itself when it is not one. */
function originOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
}

/**
 * Whether a refusal is the key's fault. 401 and 403 are, everywhere. Google answers a wrong
 * key with HTTP 400 and says so only in the body — `reason: API_KEY_INVALID` under
 * `error.details` — so a 400's body is read before it is reported as a bad request.
 */
export function isRejectedKey(status: number, body: string): boolean {
	if (status === 401 || status === 403) {
		return true;
	}
	if (status !== 400 || !body) {
		return false;
	}
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string; details?: Array<{ reason?: string }> } };
		return (parsed.error?.details ?? []).some(detail => detail?.reason === 'API_KEY_INVALID')
			|| /API key not valid/i.test(parsed.error?.message ?? '');
	} catch {
		return false;
	}
}
