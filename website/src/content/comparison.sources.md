# Comparison table — sources

Every cell on `/#compare` that names a competitor points at an entry here; a
cell with no entry is "—" on the page. Each entry is a heading, so the † link beside a cell
lands on it. Collected 2026-10-01; **every entry re-read on the vendor's own live page on
2026-10-08**, with the quote that backs the cell. Re-verify whenever the table is republished
— pricing and limits in this category change monthly.

Rows: bring your own model · local models · telemetry and relay · price · source · platforms ·
agent mode · Tab completion · remote development.

## Sirius

All Sirius cells: this repository at v1.118.7 — `README.md`, `INSTALL.md`, `PRIVACY.md`,
`LICENSE.txt`, `extensions/sirius-ai/package.json`; macOS is not built yet
([issue #9](https://github.com/sirius-ide/sirius-ide/issues/9)); the remote-extension connect is
proven since 1.118.13 ([Remote server](https://siriuside.com/docs/remote-server/)).

## Cursor

### cursor-byok
https://cursor.com/help/models-and-usage/api-keys — own keys for OpenAI, Anthropic, Google,
Azure and AWS Bedrock; "all requests are routed through Cursor's servers for final prompt
building" (no local-model path).

### cursor-data-use
https://cursor.com/data-use — Privacy Mode gives zero data retention; with it off, "we may use
and store codebase data, prompts, editor actions, code snippets… to improve our AI features and
train our models".

### cursor-pricing
https://cursor.com/help/account-and-billing/pricing.md and https://cursor.com/pricing — Hobby
free, Pro $20, Pro+ $60, Ultra $200, Teams from $40/user, Enterprise custom; "You can use
Agent, Chat, and Tab completions with the Auto model."

### cursor-downloads
https://cursor.com/downloads — "available for macOS, Windows, and Linux."

### cursor-terms
https://cursor.com/terms-of-service — "Anysphere reserves all rights to the Service not
granted in these Terms."

### cursor-changelog
https://cursor.com/changelog/page/9 (3.0, 2026-04-02) — agents "locally, in worktrees, in the
cloud, and on remote SSH"; earlier, https://cursor.com/en-US/changelog/1-3 (2025-07-29),
"Terminal more reliable over remote SSH".

## Devin Desktop (formerly Windsurf)

### devin-faq
https://docs.devin.ai/desktop/devin-desktop-faq — "Devin Desktop is the new name for Windsurf".
(windsurf.com redirects to devin.ai/desktop.)

### devin-local
https://docs.devin.ai/desktop/devin-local — Devin Local "operates on your machine with access
to your local files, tools, and environment" — a local agent on hosted models; no page offers
self-run models.

### devin-changelog
https://docs.devin.ai/desktop/changelog — v3.9.19, 2026-09-08: "Cascade has been removed.
Devin Local is now the only agent available in Devin Desktop."

### devin-pricing
https://devin.ai/pricing — Free $0, Pro $20, Max $200, Teams "$80/month for team plan +
$40/mo per full dev seat"; "purchase extra usage at API pricing"; "Unlimited Tab completions"
on every plan. (A free SWE-2 promotion runs "through October 16, 2026"; the table does not
cite it.)

### devin-install
https://docs.devin.ai/desktop/install — macOS, Windows, Linux (tar, deb, rpm).

### devin-advanced
https://docs.devin.ai/desktop/advanced — "We currently only support SSHing into Linux-based
remote hosts"; Dev Containers "on Mac, Windows, and Linux for both local and remote (via SSH)
workflows".

Bring-your-own-key: the only mention is a 2025 Windsurf changelog entry for the Cascade agent,
which was removed on 2026-09-08 — so the cell is "—".

## Zed

### zed-api-access
https://zed.dev/docs/ai/use-api-access — own keys for Anthropic, OpenAI, Google AI, Mistral,
DeepSeek, xAI, OpenCode, and Anthropic- or OpenAI-compatible endpoints.

### zed-local
https://zed.dev/docs/ai/use-a-local-model — llama.cpp, LM Studio, Ollama and any local
OpenAI-compatible server.

### zed-pricing
https://zed.dev/pricing — Personal "$0 forever"; Pro "$10 per month"; Business "$30 per seat,
per month". https://zed.dev/docs/ai/edit-prediction: "The free plan includes 2,000 Zeta
predictions per month."

### zed-telemetry
https://zed.dev/docs/telemetry — "Client-side: Usage metrics and crash reports. You can disable
these in settings."

### zed-remote
https://zed.dev/docs/remote-development — supported remote platforms: macOS, Linux (x86_64,
arm64), Windows (x86_64, arm64).

### zed-source
https://github.com/zed-industries/zed — "licensed primarily under GPL-3.0-or-later, with
Apache-2.0 components where marked."

### zed-platforms
https://zed.dev/ — "Available for macOS, Linux, and Windows."; https://zed.dev/docs/windows —
stable builds on the download page.

### zed-ai
https://zed.dev/ai — the Agent Panel and Edit Prediction (Zeta).

## Google Antigravity

### antigravity-byok
https://antigravity.google/docs/plans — "There is currently no support for… Bring-your-own-key
(BYOK) or bring-your-own-endpoint for additional rate limits".

### antigravity-local
https://antigravity.google/docs/sdk/local-models/ — an external local server (Ollama, LM
Studio, vLLM) through `LocalOpenAIAgentConfig` in the SDK; no page offers it in the editor.

### antigravity-plans
https://antigravity.google/blog/changes-to-antigravity-plans (2026-05-19) — "$20/month Google
AI Pro", "$100/month Google AI Ultra", a top tier at "$200 per month";
https://antigravity.google/pricing — Individual "$0/month… Basic weekly rate limits",
"Unlimited Tab completions".

### antigravity-download
https://antigravity.google/download — macOS (Apple Silicon, Intel), Windows (x64, ARM64),
Linux (x64, ARM64).

### antigravity-agent
https://antigravity.google/docs/ide/overview/ — "an agentic development environment built for
the agent-first era."

## Kiro (AWS)

### kiro-faq
https://kiro.dev/faq/ — models chosen from Kiro's list ("You can also choose a specific model,
including OpenAI's GPT-5.6…, Anthropic's Claude models… and open weight models"); no key or
local-model setting documented; "Kiro is based on Code OSS"; it "turn[s] prompts into
executable specs". https://github.com/kirodotdev/Kiro — "The Kiro product source code is not
hosted here."

### kiro-pricing
https://kiro.dev/pricing/ — "Kiro Free tier, which includes 50 credits"; Pro $20, Pro+ $40,
Pro Max $100, Power $200 per month.

### kiro-privacy
https://kiro.dev/docs/privacy-and-security/data-protection/ — "By default, Kiro collects usage
data, errors, crash reports, and other metrics as well as content for service improvement from
Kiro Free Tier users and Kiro individual subscribers"; opt out in settings; none on enterprise.

### kiro-downloads
https://kiro.dev/downloads/ — macOS (Apple Silicon, Intel), Windows (x64, ARM64), Linux (x64,
ARM64).

### kiro-remote
https://kiro.dev/docs/privacy-and-security/ — "Kiro supports Open VSX extensions, including
remote SSH extensions… not developed, maintained, or managed by Kiro."

## Trae (ByteDance)

### trae-models
https://docs.trae.ai/ide/models — "add models by entering the API key", or a custom
configuration (API format, request URL, model ID, authentication).

### trae-privacy
https://docs.trae.ai/ide/privacy-mode — chats and code snippets "may be used for analytics,
product improvement, and model training"; with Privacy mode on, they are not.

### trae-pricing
https://www.trae.ai/pricing — Free $0, Pro $20, Pro+ $60, Ultra $200 per month; autocompletion
"5000 / month" on Free, "Unlimited" on Pro and above.

### trae-platforms
https://www.trae.ai/download — TraeCode: "macOS 12.0+ · Windows 10, 11 · .deb / .rpm", with a
".deb (x64)" download.

### trae-agent
https://docs.trae.ai/ide/agent — custom agents with prompts, MCP servers and built-in tools.

### trae-remote
https://docs.trae.ai/ide/ssh-remote — "Currently, only the Linux operating system is
supported."
