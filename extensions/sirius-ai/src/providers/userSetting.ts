/*---------------------------------------------------------------------------------------------
 *  Sirius — settings that decide where a key goes
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A setting from the user's own settings, never a workspace's. An address a provider sends its
 * key and the user's code to must not come from a repository's .vscode/settings.json, or opening
 * a repository would choose where they go. VS Code drops workspace values only for a setting
 * declared machine-scoped, and not every provider's address is declared — none is in the VS Code
 * edition — so the user's own value is read here, whatever the declaration.
 */
export function userSetting(section: string, key: string): string | undefined {
	const value = vscode.workspace.getConfiguration(section).inspect<string>(key)?.globalValue;
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * A number or a switch from the user's own settings, never a workspace's: what the VS Code edition
 * reads for the settings that shape a request — how long an answer may be, its temperature,
 * whether it streams, how large an Ollama model may load. The edition declares none of them, and
 * VS Code applies a workspace's value for a setting nobody declared.
 */
export function userNumber(section: string, key: string): number | undefined {
	const value = vscode.workspace.getConfiguration(section).inspect<unknown>(key)?.globalValue;
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A switch from the user's own settings, never a workspace's: as {@link userNumber}. */
export function userSwitch(section: string, key: string): boolean | undefined {
	const value = vscode.workspace.getConfiguration(section).inspect<unknown>(key)?.globalValue;
	return typeof value === 'boolean' ? value : undefined;
}
