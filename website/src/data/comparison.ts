/**
 * The comparison table on the landing page. Every competitor cell names the entry in
 * src/content/comparison.sources.md that backs it; a cell without a source is "—" (BRIEF §5).
 * Collected 2026-10-01; re-verify before publishing.
 */
export const comparedOn = '2026-10-01';

export const columns = ['Sirius', 'Cursor', 'Devin Desktop (formerly Windsurf)', 'Zed', 'Google Antigravity', 'Kiro', 'Trae'] as const;

export interface Cell { text: string; source?: string; good?: boolean }
export interface Row { label: string; cells: Cell[] }

const dash: Cell = { text: '—' };

export const rows: Row[] = [
	{
		label: 'Bring your own model',
		cells: [
			{ text: 'Twelve providers + any OpenAI-compatible endpoint; keys in your keyring.', good: true },
			{ text: 'OpenAI, Anthropic, Google, Azure, Bedrock keys — requests still pass through Cursor’s servers.', source: 'cursor-byok' },
			{ text: 'An Anthropic key only, on Free and Pro.', source: 'devin-byok' },
			{ text: 'Anthropic, OpenAI, Google, DeepSeek, Mistral and more.', source: 'zed-ai-config', good: true },
			{ text: 'No.', source: 'antigravity-byok' },
			{ text: 'No.', source: 'kiro-faq' },
			{ text: 'Custom models by API key.', source: 'trae-models', good: true },
		],
	},
	{
		label: 'Local models',
		cells: [
			{ text: 'Ollama, LM Studio, llama.cpp, vLLM; Tab completion runs on them.', good: true },
			{ text: 'No — every request goes through Cursor’s servers.', source: 'cursor-byok' },
			{ text: 'No — “Devin Local” is a local agent on hosted models.', source: 'devin-changelog' },
			{ text: 'Ollama and LM Studio.', source: 'zed-ai-config', good: true },
			{ text: 'Not in the editor; the SDK only.', source: 'antigravity-local' },
			{ text: 'No.', source: 'kiro-faq' },
			dash,
		],
	},
	{
		label: 'Telemetry and relay',
		cells: [
			{ text: 'None — no telemetry, no account, no relay.', good: true },
			{ text: 'Privacy Mode stops storage; off, prompts may be saved and telemetry collected. Requests pass through Cursor.', source: 'cursor-data-use' },
			dash,
			{ text: 'Anonymous telemetry on by default; a setting turns it off.', source: 'zed-telemetry' },
			dash,
			{ text: 'Telemetry on by default; a setting turns it off.', source: 'kiro-privacy' },
			dash,
		],
	},
	{
		label: 'Price',
		cells: [
			{ text: 'Free. You pay your provider, or run local models for nothing.', good: true },
			{ text: 'Free · Pro $20/mo · Pro+ · Ultra · Business.', source: 'cursor-pricing' },
			{ text: 'Free · Pro $20/mo · Max $200/mo · Teams; usage allowances, then API pricing.', source: 'devin-pricing' },
			{ text: 'Personal $0 with your own keys · Pro $10/mo · Business $30/seat.', source: 'zed-pricing' },
			{ text: 'Individual $0 with weekly limits · Pro $20/mo · Ultra $100 and $200/mo.', source: 'antigravity-plans' },
			{ text: 'Free 50 credits/mo · Pro $20 · Pro+ $40 · Pro Max $100 · Power $200.', source: 'kiro-pricing' },
			{ text: 'Free · Lite $3 · Pro $10 · Pro+ $30 · Ultra $100 per month.', source: 'trae-pricing' },
		],
	},
	{
		label: 'Source',
		cells: [
			{ text: 'Proprietary licence; source published on GitHub; built on Code - OSS (MIT).' },
			{ text: 'Proprietary.', source: 'cursor-terms' },
			dash,
			{ text: 'Open source, GPL-3.0.', source: 'zed-source', good: true },
			dash,
			{ text: 'Proprietary, built on Code - OSS.', source: 'kiro-faq' },
			dash,
		],
	},
	{
		label: 'Platforms',
		cells: [
			{ text: 'Linux x64 and arm64 (tarball, .deb, .rpm, pacman repo); Windows x64, unsigned; macOS not yet.' },
			{ text: 'macOS, Windows, Linux.', source: 'cursor-downloads' },
			{ text: 'macOS, Windows, Linux.', source: 'devin-linux' },
			{ text: 'macOS, Linux; Windows not yet stable.', source: 'zed-platforms' },
			{ text: 'macOS, Windows, Linux.', source: 'antigravity-download' },
			{ text: 'macOS, Windows, Linux.', source: 'kiro-faq' },
			{ text: 'macOS, Windows; Linux on a waiting list.', source: 'trae-platforms' },
		],
	},
	{
		label: 'Agent mode',
		cells: [
			{ text: 'Yes — diffs with checkpoints; tools scale to the model.', good: true },
			{ text: 'Yes.', source: 'cursor-pricing' },
			{ text: 'Yes (Cascade, Devin Local).', source: 'devin-changelog' },
			{ text: 'Yes (Agent Panel).', source: 'zed-ai' },
			{ text: 'Yes — agent-first.', source: 'antigravity-agent' },
			{ text: 'Yes — spec-driven.', source: 'kiro-faq' },
			{ text: 'Yes.', source: 'trae-models' },
		],
	},
	{
		label: 'Tab completion',
		cells: [
			{ text: 'Yes, on a local FIM model; next-edit prediction optional.', good: true },
			{ text: 'Yes.', source: 'cursor-pricing' },
			{ text: 'Yes.', source: 'devin-pricing' },
			{ text: 'Yes — Edit Prediction, 2,000/mo free.', source: 'zed-pricing' },
			{ text: 'Yes — unlimited on the free tier.', source: 'antigravity-plans' },
			dash,
			{ text: 'Yes — 5,000/mo free.', source: 'trae-pricing' },
		],
	},
	{
		label: 'Remote development',
		cells: [
			{ text: 'Server ships with every release (x64, arm64); a remote-extension connect is not yet proven — we say so.' },
			{ text: 'Remote SSH.', source: 'cursor-data-use' },
			dash,
			{ text: 'SSH remoting; Linux and Mac targets.', source: 'zed-remote' },
			dash,
			{ text: 'Open VSX remote SSH extensions.', source: 'kiro-remote' },
			dash,
		],
	},
];
