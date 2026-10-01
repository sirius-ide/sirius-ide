# Comparison table — sources

Every cell on `/#compare` that names a competitor points at an entry here (BRIEF.md §5). A
cell with no entry is "—" on the page. Entries were collected on 2026-10-01 from the vendors'
own pages where one could be found; the cloud VM that built the page cannot open these sites
directly (its egress proxy blocks them), so each was read through a search engine's snippet of
the page named. **Re-verify every entry against the live page before publishing**, and again
whenever the table is republished — pricing and limits in this category change monthly.

Rows: bring your own model · local models · telemetry and relay · price · source · platforms ·
agent mode · Tab completion · remote development.

## Sirius

- All Sirius cells: this repository at v1.118.7 — `README.md`, `INSTALL.md`, `PRIVACY.md`,
  `LICENSE.txt`, `extensions/sirius-ai/package.json`, `PROJECT-STATE.md` (holes 7 and 12 for
  what is *not* yet true: macOS, the remote-extension connect).

## Cursor

- `cursor-byok` — https://cursor.com/help/models-and-usage/api-keys — own keys for OpenAI,
  Anthropic, Google, Azure and AWS Bedrock; "API keys are not stored but are uploaded to
  Cursor's servers with each request" (requests pass through Cursor; no local-model path).
- `cursor-data-use` — https://cursor.com/data-use — Privacy Mode: with it on, code is not
  stored by Cursor or third parties (OpenAI/Anthropic retain prompts 30 days); with it off,
  prompts may be saved and telemetry collected. Also names Remote SSH workspaces.
- `cursor-pricing` — https://cursor.com/pricing — Free, Pro $20/month, Pro+, Ultra, Business.
- `cursor-downloads` — https://cursor.com/downloads — macOS, Windows, Linux builds.
- `cursor-terms` — https://cursor.com/terms-of-service — proprietary licence terms.

## Devin Desktop (formerly Windsurf)

- `devin-faq` — https://docs.devin.ai/desktop/devin-desktop-faq — "Devin Desktop is the new
  name for Windsurf".
- `devin-byok` — https://docs.windsurf.com/ (Cascade models) — bring your own Anthropic key
  for the Claude models in Cascade, "only available for Free and Pro users at this time".
- `devin-changelog` — https://docs.devin.ai/desktop/changelog — Devin Local is a local *agent*
  on the same hosted models and the same credit pricing as Cascade (not local models).
- `devin-linux` — https://docs.windsurf.com/ (setup) — Linux install, including an RPM
  repository; macOS and Windows installers.
- `devin-pricing` — third-party listings only (therundown.ai, nocode.mba, devtoolsreview.com,
  2026): Free $0, Pro $20/month, Max $200/month, Teams; usage allowance, extra usage at API
  pricing. **Verify on the vendor's pricing page before publishing.**

## Zed

- `zed-ai-config` — https://zed.dev/docs/ai/configuration — own keys for Anthropic, OpenAI,
  Google AI, DeepSeek, Mistral, GitHub Copilot; local models through Ollama and LM Studio.
- `zed-pricing` — https://zed.dev/pricing — Personal $0 (2,000 accepted edit predictions,
  unlimited use with your own keys), Pro $10/month, Business $30/seat/month.
- `zed-telemetry` — https://zed.dev/docs/telemetry — anonymous telemetry on by default,
  switched off in settings; edit-prediction training data only on explicit opt-in.
- `zed-remote` — https://github.com/zed-industries/zed/blob/main/docs/src/remote-development.md
  — SSH remoting; language servers, tasks and terminals run on the remote; Linux and Mac targets.
- `zed-source` — https://zed.dev/ and https://github.com/zed-industries/zed — open source,
  GPL-3.0 for the editor.
- `zed-platforms` — https://zed.dev/ — stable releases for macOS and Linux; Windows "not
  finished yet" at the survey date.
- `zed-ai` — https://zed.dev/ai — the Agent Panel and Edit Prediction (Zeta).

## Google Antigravity

- `antigravity-download` — https://codelabs.developers.google.com/getting-started-google-antigravity
  — macOS 12+, Windows 10+ 64-bit, Linux 64-bit (glibc 2.28+, GLIBCXX 3.4.25+).
- `antigravity-plans` — https://antigravity.google/blog/changes-to-antigravity-plans —
  Individual $0 with weekly rate limits; Google AI Pro $20/month; Ultra $100 and $200/month;
  unlimited tab completions.
- `antigravity-byok` — https://discuss.ai.google.dev/t/antigravity-add-your-own-api-keys-models/137068
  — no bring-your-own-key or bring-your-own-endpoint for the editor's agent.
- `antigravity-local` — https://antigravity.google/docs/sdk/local-models/ — local models
  (Ollama, LM Studio, vLLM) are supported in the Antigravity SDK, not as the editor's model.
- `antigravity-agent` — https://developers.googleblog.com/en/build-with-google-antigravity-our-new-agentic-development-platform/
  — agent-first editor.

## Kiro (AWS)

- `kiro-faq` — https://kiro.dev/faq/ — desktop IDE for macOS, Windows and Linux; no
  bring-your-own-key and no local models; built on Code OSS with Open VSX extensions.
- `kiro-pricing` — https://kiro.dev/pricing/ — Free 50 credits/month; Pro $20 (1,000
  credits), Pro+ $40, Pro Max $100, Power $200; add-on credits $0.04 each.
- `kiro-privacy` — https://kiro.dev/docs/privacy-and-security/ — telemetry collected by
  default, switched off in settings (`telemetry.enabled false`); none on IAM Identity Center tiers.
- `kiro-remote` — https://builder.aws.com/content/3BHUl6M43xtQ0niutCXtw4zg4RH/kiro-best-practices-a-field-guide-for-development-teams
  — Open VSX remote SSH extensions supported.

## Trae (ByteDance)

- `trae-models` — https://docs.trae.ai/ide/models — custom models from preset providers by
  API key, or a custom configuration (API format, request URL, model id).
- `trae-pricing` — third-party listings only (hokai.io, aiagentsquare.com, vibecoding.app,
  2026): Free, Lite $3, Pro $10, Pro+ $30, Ultra $100 per month; Free includes 5,000
  autocompletions/month. **Verify on the vendor's pricing page before publishing.**
- `trae-platforms` — third-party listings only (aiidelist.com, vibecoding.app, 2026): macOS
  and Windows; Linux on a waiting list. **Verify before publishing.**
- Telemetry and local models: no vendor page found; left "—".
