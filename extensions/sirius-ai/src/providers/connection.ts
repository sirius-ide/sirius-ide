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

/** One cheap authenticated GET — a model listing — read as a verdict. */
export async function checkEndpoint(url: string, headers: Record<string, string>, provider: string): Promise<ConnectionCheck> {
	try {
		const response = await fetch(url, { headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
		if (response.ok) {
			return { ok: true };
		}
		if (response.status === 401 || response.status === 403) {
			return { ok: false, problem: `${provider} rejected the API key (HTTP ${response.status}).` };
		}
		return { ok: false, problem: `${provider} answered HTTP ${response.status} at ${new URL(url).origin}.` };
	} catch {
		return { ok: false, problem: `${provider} did not answer at ${new URL(url).origin}.` };
	}
}
