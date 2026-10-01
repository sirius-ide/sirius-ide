/** The shipped extension manifest, read at build so the reference tables cannot drift from the product. */
import manifest from '../../../../extensions/sirius-ai/package.json';

type Title = string | { value: string; original?: string };
const text = (t: Title | undefined) => (typeof t === 'string' ? t : t?.value ?? '');

export interface CommandRow { command: string; title: string; category?: string }
export interface KeybindingRow { command: string; title: string; key: string; mac?: string; when?: string }
export interface SettingRow { key: string; type: string; defaultValue: string; description: string; deprecated?: string; enumValues?: string[] }

const contributes = (manifest as { contributes?: Record<string, unknown> }).contributes ?? {};
const rawCommands = (contributes.commands ?? []) as Array<{ command: string; title: Title; category?: string }>;
const rawKeys = (contributes.keybindings ?? []) as Array<{ command: string; key: string; mac?: string; when?: string }>;
const rawConfig = contributes.configuration as { title?: string; properties?: Record<string, Record<string, unknown>> } | Array<{ title?: string; properties?: Record<string, Record<string, unknown>> }> | undefined;

export const extensionVersion = (manifest as { version: string }).version;
export const commands: CommandRow[] = rawCommands.map((c) => ({ command: c.command, title: text(c.title), category: c.category }));
const titleOf = (id: string) => commands.find((c) => c.command === id)?.title ?? id;
export const keybindings: KeybindingRow[] = rawKeys.map((k) => ({ command: k.command, title: titleOf(k.command), key: k.key, mac: k.mac, when: k.when }));

const stringify = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? (v === '' ? '""' : v) : JSON.stringify(v));
const properties = (Array.isArray(rawConfig) ? rawConfig : [rawConfig]).flatMap((c) => Object.entries(c?.properties ?? {}));
export const settings: SettingRow[] = properties.map(([key, v]) => ({
	key,
	type: Array.isArray(v.type) ? (v.type as string[]).join(' | ') : String(v.type ?? ''),
	defaultValue: stringify(v.default),
	description: String(v.markdownDescription ?? v.description ?? ''),
	deprecated: v.deprecationMessage ? String(v.deprecationMessage) : undefined,
	enumValues: Array.isArray(v.enum) ? (v.enum as string[]) : undefined,
}));
export const currentSettings = settings.filter((s) => !s.deprecated);
export const deprecatedSettings = settings.filter((s) => s.deprecated);

/** `#sirius.ai.completions.model#` in a VS Code markdownDescription is a settings link; render it as code. */
export const describe = (s: string) => s.replace(/#([a-z0-9.]+)#/gi, '`$1`');
